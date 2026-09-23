use std::collections::BTreeMap;

use tokio_postgres::Transaction;

use super::{map_pg_err, quote_ident, quote_literal, PostgresAdapter};
use crate::db::schema_catalog::CatalogObject;

fn not_extension(class: &str, oid: &str) -> String {
    format!(
        "NOT EXISTS (SELECT 1 FROM pg_depend dep WHERE dep.classid = '{class}'::regclass AND dep.objid = {oid} AND dep.deptype = 'e')"
    )
}

fn qualified(schema: &str, name: &str) -> String {
    format!("{}.{}", quote_ident(schema), quote_ident(name))
}

fn relation_keyword(relkind: &str) -> &'static str {
    match relkind {
        "v" => "VIEW",
        "m" => "MATERIALIZED VIEW",
        "S" => "SEQUENCE",
        _ => "TABLE",
    }
}

async fn rows(
    tx: &Transaction<'_>,
    sql: &str,
    schema: &str,
) -> Result<Vec<tokio_postgres::Row>, String> {
    tx.query(sql, &[&schema]).await.map_err(map_pg_err)
}

impl PostgresAdapter {
    pub(super) async fn schema_catalog_impl(
        &self,
        schema: &str,
        types: &[String],
    ) -> Result<Vec<CatalogObject>, String> {
        if self.session.is_some() {
            return Err(
                "Der Schema-Vergleich ist innerhalb einer offenen Transaktion nicht verfügbar."
                    .to_string(),
            );
        }
        let want = |kind: &str| types.iter().any(|item| item == kind);
        let mut conn = self.get_meta().await?;
        let token = conn.cancel_token();
        self.timed(token, async {
            let tx = conn.transaction().await.map_err(map_pg_err)?;
            tx.batch_execute("SET LOCAL search_path TO pg_catalog")
                .await
                .map_err(map_pg_err)?;
            let mut out = Vec::new();
            if want("type") {
                catalog_types(&tx, schema, &mut out).await?;
            }
            if want("sequence") {
                catalog_sequences(&tx, schema, &mut out).await?;
            }
            if want("table") {
                catalog_tables(&tx, schema, &mut out).await?;
            }
            if want("constraint") {
                catalog_constraints(&tx, schema, &mut out).await?;
            }
            if want("index") {
                catalog_indexes(&tx, schema, &mut out).await?;
            }
            if want("view") || want("materialized_view") {
                catalog_views(
                    &tx,
                    schema,
                    want("view"),
                    want("materialized_view"),
                    &mut out,
                )
                .await?;
            }
            if want("function") || want("procedure") {
                catalog_routines(&tx, schema, want("function"), want("procedure"), &mut out)
                    .await?;
            }
            if want("trigger") {
                catalog_triggers(&tx, schema, &mut out).await?;
            }
            if want("comment") {
                catalog_comments(&tx, schema, &mut out).await?;
            }
            if want("grant") {
                catalog_grants(&tx, schema, &mut out).await?;
            }
            tx.rollback().await.map_err(map_pg_err)?;
            Ok(out)
        })
        .await
    }
}

async fn catalog_tables(
    tx: &Transaction<'_>,
    schema: &str,
    out: &mut Vec<CatalogObject>,
) -> Result<(), String> {
    let columns = rows(
        tx,
        &format!(
            "SELECT c.relname, a.attname, format_type(a.atttypid, a.atttypmod), a.attnotnull, \
                    pg_get_expr(d.adbin, d.adrelid), a.attidentity::text, a.attgenerated::text, \
                    CASE WHEN a.attcollation <> 0 AND a.attcollation <> t.typcollation THEN \
                      (SELECT quote_ident(cn.nspname) || '.' || quote_ident(co.collname) FROM pg_collation co \
                       JOIN pg_namespace cn ON cn.oid = co.collnamespace WHERE co.oid = a.attcollation) END \
             FROM pg_attribute a \
             JOIN pg_class c ON c.oid = a.attrelid \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             JOIN pg_type t ON t.oid = a.atttypid \
             LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum \
             WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND a.attnum > 0 AND NOT a.attisdropped \
               AND a.attislocal AND {} \
             ORDER BY c.relname, a.attnum",
            not_extension("pg_class", "c.oid")
        ),
        schema,
    )
    .await?;
    let mut by_table: BTreeMap<String, Vec<String>> = BTreeMap::new();
    for r in &columns {
        let table: String = r.get(0);
        let name: String = r.get(1);
        let data_type: String = r.get(2);
        let not_null: bool = r.get(3);
        let default: Option<String> = r.get(4);
        let identity: String = r.get(5);
        let generated: String = r.get(6);
        let collation: Option<String> = r.get(7);
        let mut ddl = format!("{} {data_type}", quote_ident(&name));
        let mut object = CatalogObject::new("column", name, Some(table.clone()), "")
            .attr("type", data_type)
            .attr("nullable", if not_null { "NO" } else { "YES" });
        if let Some(collation) = collation {
            ddl.push_str(&format!(" COLLATE {collation}"));
            object = object.attr("collation", collation);
        }
        if generated == "s" {
            let expression = default.unwrap_or_default();
            ddl.push_str(&format!(" GENERATED ALWAYS AS ({expression}) STORED"));
            object = object.attr("generated", expression);
        } else if !identity.is_empty() {
            let mode = if identity == "a" {
                "ALWAYS"
            } else {
                "BY DEFAULT"
            };
            ddl.push_str(&format!(" GENERATED {mode} AS IDENTITY"));
            object = object.attr("identity", mode);
        } else if let Some(default) = default {
            ddl.push_str(&format!(" DEFAULT {default}"));
            object = object.attr("default", default);
        }
        if not_null {
            ddl.push_str(" NOT NULL");
        }
        by_table.entry(table).or_default().push(ddl.clone());
        object.ddl = ddl;
        out.push(object);
    }
    let tables = rows(
        tx,
        &format!(
            "SELECT c.relname, c.relkind::text, c.relpersistence::text, c.relispartition, \
                    CASE WHEN c.relkind = 'p' THEN pg_get_partkeydef(c.oid) END, \
                    CASE WHEN c.relispartition THEN (SELECT i.inhparent::regclass::text FROM pg_inherits i WHERE i.inhrelid = c.oid LIMIT 1) END, \
                    CASE WHEN c.relispartition THEN pg_get_expr(c.relpartbound, c.oid) END \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relkind IN ('r', 'p') AND {} \
             ORDER BY c.relname",
            not_extension("pg_class", "c.oid")
        ),
        schema,
    )
    .await?;
    for r in &tables {
        let name: String = r.get(0);
        let persistence: String = r.get(2);
        let is_partition: bool = r.get(3);
        let partition_key: Option<String> = r.get(4);
        let parent: Option<String> = r.get(5);
        let bound: Option<String> = r.get(6);
        let unlogged = if persistence == "u" { "UNLOGGED " } else { "" };
        let columns = by_table.remove(&name).unwrap_or_default();
        let mut ddl = if is_partition {
            format!(
                "CREATE {unlogged}TABLE {} PARTITION OF {} {}",
                qualified(schema, &name),
                parent.clone().unwrap_or_default(),
                bound.unwrap_or_default()
            )
        } else {
            format!(
                "CREATE {unlogged}TABLE {} (\n  {}\n)",
                qualified(schema, &name),
                columns.join(",\n  ")
            )
        };
        let mut object = CatalogObject::new("table", name, None, "");
        if let Some(key) = partition_key {
            ddl.push_str(&format!(" PARTITION BY {key}"));
            object = object.attr("partition_key", key);
        }
        if let Some(parent) = parent {
            object = object.attr("partition_of", parent);
        }
        if !unlogged.is_empty() {
            object = object.attr("unlogged", "YES");
        }
        object.ddl = ddl;
        out.push(object);
    }
    Ok(())
}

async fn catalog_constraints(
    tx: &Transaction<'_>,
    schema: &str,
    out: &mut Vec<CatalogObject>,
) -> Result<(), String> {
    let found = rows(
        tx,
        &format!(
            "SELECT c.relname, con.conname, con.contype::text, pg_get_constraintdef(con.oid), \
                    CASE WHEN con.contype = 'f' AND rn.nspname = $1 THEN rc.relname END \
             FROM pg_constraint con \
             JOIN pg_class c ON c.oid = con.conrelid \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             LEFT JOIN pg_class rc ON rc.oid = con.confrelid \
             LEFT JOIN pg_namespace rn ON rn.oid = rc.relnamespace \
             WHERE n.nspname = $1 AND con.contype IN ('p', 'u', 'f', 'c', 'x') AND con.conislocal \
               AND con.conparentid = 0 AND c.relkind IN ('r', 'p') AND {} \
             ORDER BY c.relname, con.conname",
            not_extension("pg_class", "c.oid")
        ),
        schema,
    )
    .await?;
    for r in &found {
        let table: String = r.get(0);
        let name: String = r.get(1);
        let kind = match r.get::<_, String>(2).as_str() {
            "p" => "P",
            "u" => "U",
            "f" => "R",
            "x" => "X",
            _ => "C",
        };
        let definition: String = r.get(3);
        let references: Option<String> = r.get(4);
        let ddl = format!(
            "ALTER TABLE {} ADD CONSTRAINT {} {definition}",
            qualified(schema, &table),
            quote_ident(&name)
        );
        let mut object = CatalogObject::new("constraint", name, Some(table), ddl)
            .attr("kind", kind)
            .attr("definition", definition);
        if let Some(references) = references {
            object = object.attr("references", references);
        }
        out.push(object);
    }
    Ok(())
}

async fn catalog_indexes(
    tx: &Transaction<'_>,
    schema: &str,
    out: &mut Vec<CatalogObject>,
) -> Result<(), String> {
    let found = rows(
        tx,
        &format!(
            "SELECT t.relname, i.relname, pg_get_indexdef(i.oid), i.relkind::text \
             FROM pg_index x \
             JOIN pg_class i ON i.oid = x.indexrelid \
             JOIN pg_class t ON t.oid = x.indrelid \
             JOIN pg_namespace n ON n.oid = t.relnamespace \
             WHERE n.nspname = $1 AND t.relkind IN ('r', 'p', 'm') AND {} \
               AND NOT EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = x.indexrelid \
                               AND con.conrelid = x.indrelid AND con.contype IN ('p', 'u', 'x')) \
               AND NOT EXISTS (SELECT 1 FROM pg_inherits h WHERE h.inhrelid = x.indexrelid) \
             ORDER BY t.relname, i.relname",
            not_extension("pg_class", "t.oid")
        ),
        schema,
    )
    .await?;
    for r in &found {
        let table: String = r.get(0);
        let name: String = r.get(1);
        let mut ddl: String = r.get(2);
        if r.get::<_, String>(3) == "I" {
            ddl = ddl.replacen(" ON ONLY ", " ON ", 1);
        }
        out.push(CatalogObject::new("index", name, Some(table), ddl));
    }
    Ok(())
}

async fn catalog_views(
    tx: &Transaction<'_>,
    schema: &str,
    views: bool,
    materialized: bool,
    out: &mut Vec<CatalogObject>,
) -> Result<(), String> {
    let found = rows(
        tx,
        &format!(
            "SELECT c.relname, c.relkind::text, pg_get_viewdef(c.oid, true), array_to_string(c.reloptions, ', '), \
                    pg_get_userbyid(c.relowner) \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             WHERE n.nspname = $1 AND c.relkind IN ('v', 'm') AND {} \
             ORDER BY c.relname",
            not_extension("pg_class", "c.oid")
        ),
        schema,
    )
    .await?;
    for r in &found {
        let name: String = r.get(0);
        let kind: String = r.get(1);
        let definition: Option<String> = r.get(2);
        let options: Option<String> = r.get(3);
        let owner: String = r.get(4);
        let body = definition.unwrap_or_default();
        let body = body.trim().trim_end_matches(';').trim_end();
        if kind == "v" && views {
            let with = options
                .filter(|value| !value.is_empty())
                .map(|value| format!(" WITH ({value})"))
                .unwrap_or_default();
            let ddl = format!(
                "CREATE OR REPLACE VIEW {}{with} AS\n{body}",
                qualified(schema, &name)
            );
            out.push(CatalogObject::new("view", name, None, ddl).attr("owner", owner));
        } else if kind == "m" && materialized {
            let ddl = format!(
                "CREATE MATERIALIZED VIEW {} AS\n{body}",
                qualified(schema, &name)
            );
            out.push(CatalogObject::new("materialized_view", name, None, ddl).attr("owner", owner));
        }
    }
    Ok(())
}

async fn catalog_routines(
    tx: &Transaction<'_>,
    schema: &str,
    functions: bool,
    procedures: bool,
    out: &mut Vec<CatalogObject>,
) -> Result<(), String> {
    let found = rows(
        tx,
        &format!(
            "SELECT p.proname, pg_get_function_identity_arguments(p.oid), p.prokind::text, pg_get_functiondef(p.oid) \
             FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace \
             WHERE n.nspname = $1 AND p.prokind IN ('f', 'p') AND {} \
             ORDER BY p.proname, 2",
            not_extension("pg_proc", "p.oid")
        ),
        schema,
    )
    .await?;
    for r in &found {
        let name: String = r.get(0);
        let arguments: String = r.get(1);
        let kind = if r.get::<_, String>(2) == "p" {
            "procedure"
        } else {
            "function"
        };
        if (kind == "function" && !functions) || (kind == "procedure" && !procedures) {
            continue;
        }
        let ddl: String = r.get(3);
        out.push(
            CatalogObject::new(
                kind,
                format!("{name}({arguments})"),
                None,
                ddl.trim_end().to_string(),
            )
            .attr("routine", name)
            .attr("arguments", arguments),
        );
    }
    Ok(())
}

async fn catalog_triggers(
    tx: &Transaction<'_>,
    schema: &str,
    out: &mut Vec<CatalogObject>,
) -> Result<(), String> {
    let found = rows(
        tx,
        "SELECT c.relname, t.tgname, pg_get_triggerdef(t.oid, true), t.tgenabled::text \
         FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = $1 AND NOT t.tgisinternal AND t.tgparentid = 0 \
         ORDER BY c.relname, t.tgname",
        schema,
    )
    .await?;
    for r in &found {
        let table: String = r.get(0);
        let name: String = r.get(1);
        let ddl: String = r.get(2);
        let enabled: String = r.get(3);
        out.push(CatalogObject::new("trigger", name, Some(table), ddl).attr(
            "status",
            if enabled == "D" {
                "DISABLED"
            } else {
                "ENABLED"
            },
        ));
    }
    Ok(())
}

async fn catalog_sequences(
    tx: &Transaction<'_>,
    schema: &str,
    out: &mut Vec<CatalogObject>,
) -> Result<(), String> {
    let found = rows(
        tx,
        "SELECT c.relname, format_type(s.seqtypid, NULL), s.seqstart::text, s.seqincrement::text, s.seqmin::text, \
                s.seqmax::text, s.seqcache::text, s.seqcycle, ps.last_value::text, t.relname, a.attname \
         FROM pg_sequence s \
         JOIN pg_class c ON c.oid = s.seqrelid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         LEFT JOIN pg_sequences ps ON ps.schemaname = n.nspname AND ps.sequencename = c.relname \
         LEFT JOIN pg_depend d ON d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'a' \
                              AND d.refclassid = 'pg_class'::regclass \
         LEFT JOIN pg_class t ON t.oid = d.refobjid AND t.relnamespace = n.oid \
         LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid \
         WHERE n.nspname = $1 AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_class'::regclass \
                                               AND d.objid = c.oid AND d.deptype IN ('i', 'e')) \
         ORDER BY c.relname",
        schema,
    )
    .await?;
    for r in &found {
        let name: String = r.get(0);
        let data_type: String = r.get(1);
        let start: String = r.get(2);
        let increment: String = r.get(3);
        let min: String = r.get(4);
        let max: String = r.get(5);
        let cache: String = r.get(6);
        let cycle = if r.get::<_, bool>(7) {
            "CYCLE"
        } else {
            "NO CYCLE"
        };
        let current: Option<String> = r.get(8);
        let ddl = format!(
            "CREATE SEQUENCE {} AS {data_type} INCREMENT BY {increment} MINVALUE {min} MAXVALUE {max} START WITH {start} CACHE {cache} {cycle}",
            qualified(schema, &name)
        );
        let owner: Option<String> = r.get(9);
        let column: Option<String> = r.get(10);
        let mut object =
            CatalogObject::new("sequence", name, owner.filter(|_| column.is_some()), ddl)
                .attr("type", data_type)
                .attr("start", start)
                .attr("increment", increment)
                .attr("min", min)
                .attr("max", max)
                .attr("cache", cache)
                .attr("cycle", cycle);
        if let Some(current) = current {
            object = object.attr("current", current);
        }
        if let (Some(column), Some(_)) = (column, &object.parent) {
            object = object.attr("owned_column", column);
        }
        out.push(object);
    }
    Ok(())
}

async fn catalog_types(
    tx: &Transaction<'_>,
    schema: &str,
    out: &mut Vec<CatalogObject>,
) -> Result<(), String> {
    let found = rows(
        tx,
        &format!(
            "SELECT t.typname, t.typtype::text, \
                    CASE WHEN t.typtype = 'e' THEN (SELECT array_to_json(array_agg(e.enumlabel ORDER BY e.enumsortorder))::text \
                                                   FROM pg_enum e WHERE e.enumtypid = t.oid) END, \
                    CASE t.typtype \
                      WHEN 'd' THEN format_type(t.typbasetype, t.typtypmod) \
                        || COALESCE(' DEFAULT ' || t.typdefault, '') \
                        || CASE WHEN t.typnotnull THEN ' NOT NULL' ELSE '' END \
                        || COALESCE((SELECT string_agg(' CONSTRAINT ' || quote_ident(con.conname) || ' ' || pg_get_constraintdef(con.oid), '' ORDER BY con.conname) \
                                     FROM pg_constraint con WHERE con.contypid = t.oid AND con.contype = 'c'), '') \
                      WHEN 'c' THEN (SELECT string_agg(quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod), ', ' ORDER BY a.attnum) \
                                     FROM pg_attribute a WHERE a.attrelid = t.typrelid AND a.attnum > 0 AND NOT a.attisdropped) \
                    END \
             FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace \
             WHERE n.nspname = $1 AND {} AND (t.typtype IN ('e', 'd') OR (t.typtype = 'c' AND EXISTS ( \
                   SELECT 1 FROM pg_class r WHERE r.oid = t.typrelid AND r.relkind = 'c'))) \
             ORDER BY t.typname",
            not_extension("pg_type", "t.oid")
        ),
        schema,
    )
    .await?;
    for r in &found {
        let name: String = r.get(0);
        let kind: String = r.get(1);
        let labels: Option<String> = r.get(2);
        let body: Option<String> = r.get(3);
        let target = qualified(schema, &name);
        let object = match kind.as_str() {
            "e" => {
                let labels = labels.unwrap_or_else(|| "[]".to_string());
                let values: Vec<String> = serde_json::from_str(&labels).unwrap_or_default();
                let list = values
                    .iter()
                    .map(|value| quote_literal(value))
                    .collect::<Vec<_>>()
                    .join(", ");
                CatalogObject::new(
                    "type",
                    name,
                    None,
                    format!("CREATE TYPE {target} AS ENUM ({list})"),
                )
                .attr("kind", "enum")
                .attr("labels", labels)
            }
            "d" => CatalogObject::new(
                "type",
                name,
                None,
                format!("CREATE DOMAIN {target} AS {}", body.unwrap_or_default()),
            )
            .attr("kind", "domain"),
            _ => CatalogObject::new(
                "type",
                name,
                None,
                format!("CREATE TYPE {target} AS ({})", body.unwrap_or_default()),
            )
            .attr("kind", "composite"),
        };
        out.push(object);
    }
    Ok(())
}

async fn catalog_comments(
    tx: &Transaction<'_>,
    schema: &str,
    out: &mut Vec<CatalogObject>,
) -> Result<(), String> {
    let found = rows(
        tx,
        &format!(
            "SELECT c.relname, a.attname, d.description, c.relkind::text \
             FROM pg_description d \
             JOIN pg_class c ON c.oid = d.objoid \
             JOIN pg_namespace n ON n.oid = c.relnamespace \
             LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = d.objsubid AND d.objsubid > 0 \
             WHERE d.classoid = 'pg_class'::regclass AND n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm') \
               AND (d.objsubid = 0 OR a.attname IS NOT NULL) AND {} \
             ORDER BY c.relname, a.attname NULLS FIRST",
            not_extension("pg_class", "c.oid")
        ),
        schema,
    )
    .await?;
    for r in &found {
        let table: String = r.get(0);
        let column: Option<String> = r.get(1);
        let text: String = r.get(2);
        let relkind: String = r.get(3);
        let object = match column {
            Some(column) => CatalogObject::new(
                "comment",
                format!("{table}.{column}"),
                Some(table.clone()),
                format!(
                    "COMMENT ON COLUMN {}.{} IS {}",
                    qualified(schema, &table),
                    quote_ident(&column),
                    quote_literal(&text)
                ),
            ),
            None => CatalogObject::new(
                "comment",
                table.clone(),
                Some(table.clone()),
                format!(
                    "COMMENT ON {} {} IS {}",
                    relation_keyword(&relkind),
                    qualified(schema, &table),
                    quote_literal(&text)
                ),
            ),
        };
        out.push(object);
    }
    Ok(())
}

async fn catalog_grants(
    tx: &Transaction<'_>,
    schema: &str,
    out: &mut Vec<CatalogObject>,
) -> Result<(), String> {
    let found = rows(
        tx,
        &format!(
            "SELECT c.relname, c.relkind::text, \
                    CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee)::text END, \
                    a.privilege_type, a.is_grantable \
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
             CROSS JOIN LATERAL aclexplode(c.relacl) a \
             WHERE n.nspname = $1 AND c.relkind IN ('r', 'p', 'v', 'm', 'S') AND a.grantee <> c.relowner AND {} \
             ORDER BY 1, 3, 4",
            not_extension("pg_class", "c.oid")
        ),
        schema,
    )
    .await?;
    for r in &found {
        let object: String = r.get(0);
        let relkind: String = r.get(1);
        let grantee: String = r.get(2);
        let privilege: String = r.get(3);
        let grantable: bool = r.get(4);
        let keyword = if relkind == "S" { "SEQUENCE" } else { "TABLE" };
        let to = if grantee == "PUBLIC" {
            grantee.clone()
        } else {
            quote_ident(&grantee)
        };
        let ddl = format!(
            "GRANT {privilege} ON {keyword} {} TO {to}{}",
            qualified(schema, &object),
            if grantable { " WITH GRANT OPTION" } else { "" }
        );
        out.push(
            CatalogObject::new(
                "grant",
                format!("{privilege} TO {grantee}"),
                Some(object),
                ddl,
            )
            .attr("privilege", privilege)
            .attr("grantee", grantee),
        );
    }
    Ok(())
}
