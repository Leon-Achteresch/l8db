use std::collections::{BTreeMap, HashMap, HashSet};

use super::{create_script, fetch, lit, quote, s, view_create_script, OracleAdapter};
use crate::db::schema_catalog::CatalogObject;

const SYSTEM_TYPE_OWNERS: [&str; 6] = ["SYS", "PUBLIC", "MDSYS", "XDB", "CTXSYS", "ORDSYS"];

fn column_type(
    data_type: &str,
    type_owner: &str,
    length: &str,
    precision: &str,
    scale: &str,
    char_length: &str,
    char_used: &str,
) -> String {
    match data_type {
        "VARCHAR2" | "CHAR" => format!(
            "{data_type}({char_length} {})",
            if char_used == "C" { "CHAR" } else { "BYTE" }
        ),
        "NVARCHAR2" | "NCHAR" => format!("{data_type}({char_length})"),
        "RAW" | "UROWID" => format!("{data_type}({length})"),
        "FLOAT" if !precision.is_empty() => format!("FLOAT({precision})"),
        "NUMBER" => match (precision, scale) {
            ("", "") => "NUMBER".to_string(),
            ("", scale) => format!("NUMBER(*,{scale})"),
            (precision, "" | "0") => format!("NUMBER({precision})"),
            (precision, scale) => format!("NUMBER({precision},{scale})"),
        },
        _ if !type_owner.is_empty() && !SYSTEM_TYPE_OWNERS.contains(&type_owner) => {
            format!("{}.{}", quote(type_owner), quote(data_type))
        }
        _ => data_type.to_string(),
    }
}

fn is_not_null_check(condition: &str) -> bool {
    condition
        .trim()
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix("\" IS NOT NULL"))
        .is_some_and(|name| !name.is_empty() && !name.contains('"'))
}

fn partition_clause(ddl: &str) -> Option<&str> {
    ddl.match_indices("PARTITION BY")
        .find(|(index, _)| ddl[..*index].ends_with(char::is_whitespace))
        .map(|(index, _)| ddl[index..].trim_end())
}

fn columns_list(columns: &[String]) -> String {
    columns
        .iter()
        .map(|column| quote(column))
        .collect::<Vec<_>>()
        .join(", ")
}

impl OracleAdapter {
    pub(super) async fn schema_catalog_impl(
        &self,
        schema: &str,
        types: &[String],
    ) -> Result<Vec<CatalogObject>, String> {
        let want = |kind: &str| types.iter().any(|item| item == kind);
        let mut out = Vec::new();
        let tables = if want("table") || want("constraint") || want("index") {
            self.catalog_table_names(schema).await?
        } else {
            HashSet::new()
        };
        if want("table") || want("constraint") {
            let mut constraints = Vec::new();
            self.catalog_constraints(schema, &tables, &mut constraints)
                .await?;
            if want("table") {
                let primary_keys: HashMap<String, String> = constraints
                    .iter()
                    .filter(|c| c.attributes.get("kind").is_some_and(|kind| kind == "P"))
                    .filter_map(|c| {
                        let table = c.parent.clone()?;
                        let prefix =
                            format!("ALTER TABLE {}.{} ADD ", quote(schema), quote(&table));
                        Some((table, c.ddl.strip_prefix(&prefix)?.to_string()))
                    })
                    .collect();
                self.catalog_tables(schema, &tables, &primary_keys, &mut out)
                    .await?;
            }
            if want("constraint") {
                out.extend(constraints);
            }
        }
        if want("index") {
            self.catalog_indexes(schema, &mut out).await?;
        }
        if want("view") {
            self.catalog_views(schema, &mut out).await?;
        }
        if want("materialized_view") {
            self.catalog_mviews(schema, &mut out).await?;
        }
        if want("sequence") {
            self.catalog_sequences(schema, &mut out).await?;
        }
        let code: Vec<(&str, &str)> = [
            ("FUNCTION", "function"),
            ("PROCEDURE", "procedure"),
            ("PACKAGE", "package"),
            ("PACKAGE BODY", "package_body"),
            ("TYPE", "type"),
            ("TYPE BODY", "type_body"),
            ("TRIGGER", "trigger"),
        ]
        .into_iter()
        .filter(|(_, kind)| want(kind))
        .collect();
        if !code.is_empty() {
            self.catalog_source(schema, &code, &mut out).await?;
        }
        if want("synonym") {
            self.catalog_synonyms(schema, &mut out).await?;
        }
        if want("comment") {
            self.catalog_comments(schema, &mut out).await?;
        }
        if want("grant") {
            self.catalog_grants(schema, &mut out).await?;
        }
        Ok(out)
    }

    async fn catalog_table_names(&self, schema: &str) -> Result<HashSet<String>, String> {
        let owner = lit(schema);
        Ok(self
            .rows(format!(
                "SELECT t.table_name FROM all_tables t \
                 WHERE t.owner = {owner} AND t.nested = 'NO' AND t.secondary = 'N' AND t.dropped = 'NO' \
                 AND (t.iot_type IS NULL OR t.iot_type = 'IOT') \
                 AND t.table_name NOT LIKE 'BIN$%' AND t.table_name NOT LIKE 'MLOG$\\_%' ESCAPE '\\' \
                 AND t.table_name NOT LIKE 'RUPD$\\_%' ESCAPE '\\' AND t.table_name NOT LIKE 'AQ$%' \
                 AND NOT EXISTS (SELECT 1 FROM all_mviews m WHERE m.owner = t.owner AND m.container_name = t.table_name) \
                 AND NOT EXISTS (SELECT 1 FROM all_external_tables e WHERE e.owner = t.owner AND e.table_name = t.table_name)"
            ))
            .await?
            .iter()
            .map(|r| s(r, 0))
            .collect())
    }

    async fn catalog_tables(
        &self,
        schema: &str,
        tables: &HashSet<String>,
        primary_keys: &HashMap<String, String>,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let owner = lit(schema);
        let meta = self
            .rows(format!(
                "SELECT table_name, temporary, duration, partitioned, iot_type FROM all_tables WHERE owner = {owner}"
            ))
            .await?;
        let columns = self
            .rows(format!(
                "SELECT c.table_name, c.column_name, c.data_type, c.data_type_owner, c.data_length, c.data_precision, \
                        c.data_scale, c.char_length, c.char_used, c.nullable, c.data_default, c.virtual_column, \
                        c.default_on_null, ic.generation_type \
                 FROM all_tab_cols c \
                 LEFT JOIN all_tab_identity_cols ic ON ic.owner = c.owner AND ic.table_name = c.table_name AND ic.column_name = c.column_name \
                 WHERE c.owner = {owner} AND c.hidden_column = 'NO' AND c.table_name NOT LIKE 'BIN$%' \
                 ORDER BY c.table_name, c.column_id"
            ))
            .await?;
        let mut by_table: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for r in &columns {
            let table = s(r, 0);
            if !tables.contains(&table) {
                continue;
            }
            let name = s(r, 1);
            let data_type = column_type(
                &s(r, 2),
                &s(r, 3),
                &s(r, 4),
                &s(r, 5),
                &s(r, 6),
                &s(r, 7),
                &s(r, 8),
            );
            let nullable = s(r, 9);
            let default = s(r, 10).trim().to_string();
            let is_virtual = s(r, 11) == "YES";
            let on_null = s(r, 12) == "YES";
            let identity = s(r, 13);
            let mut ddl = format!("{} {data_type}", quote(&name));
            let mut object = CatalogObject::new("column", name.clone(), Some(table.clone()), "")
                .attr("type", data_type.clone())
                .attr("nullable", if nullable == "N" { "NO" } else { "YES" });
            if is_virtual {
                ddl.push_str(&format!(" GENERATED ALWAYS AS ({default}) VIRTUAL"));
                object = object.attr("virtual", default);
            } else if !identity.is_empty() {
                let identity = if on_null && identity == "BY DEFAULT" {
                    "BY DEFAULT ON NULL".to_string()
                } else {
                    identity
                };
                ddl.push_str(&format!(" GENERATED {identity} AS IDENTITY"));
                object = object.attr("identity", identity);
            } else if !default.is_empty() {
                let default = if on_null {
                    format!("ON NULL {default}")
                } else {
                    default
                };
                ddl.push_str(&format!(" DEFAULT {default}"));
                object = object.attr("default", default);
            }
            if nullable == "N" {
                ddl.push_str(" NOT NULL");
            }
            by_table.entry(table).or_default().push(ddl.clone());
            object.ddl = ddl;
            out.push(object);
        }
        let partitioned = self.partitioned_table_ddl(schema).await.unwrap_or_default();
        for r in &meta {
            let table = s(r, 0);
            if !tables.contains(&table) {
                continue;
            }
            let temporary = s(r, 1) == "Y";
            let mut columns = by_table.remove(&table).unwrap_or_default();
            let iot_key = primary_keys.get(&table).filter(|_| s(r, 4) == "IOT");
            columns.extend(iot_key.cloned());
            let mut ddl = format!(
                "CREATE {}TABLE {}.{}\n(\n  {}\n)",
                if temporary { "GLOBAL TEMPORARY " } else { "" },
                quote(schema),
                quote(&table),
                columns.join(",\n  ")
            );
            if iot_key.is_some() {
                ddl.push_str(" ORGANIZATION INDEX");
            }
            if temporary {
                ddl.push_str(if s(r, 2) == "SYS$TRANSACTION" {
                    " ON COMMIT DELETE ROWS"
                } else {
                    " ON COMMIT PRESERVE ROWS"
                });
            }
            let mut object = CatalogObject::new("table", table.clone(), None, "");
            if temporary {
                object = object.attr("temporary", s(r, 2));
            }
            if s(r, 3) == "YES" {
                object = object.attr("partitioned", "YES");
                if let Some(clause) = partitioned
                    .get(&table)
                    .and_then(|full| partition_clause(full))
                {
                    ddl = format!("{ddl}\n{clause}");
                }
            }
            if s(r, 4) == "IOT" {
                object = object.attr("organization", "INDEX");
            }
            object.ddl = ddl;
            out.push(object);
        }
        Ok(())
    }

    async fn partitioned_table_ddl(&self, schema: &str) -> Result<HashMap<String, String>, String> {
        let sql = format!(
            "SELECT table_name, DBMS_METADATA.GET_DDL('TABLE', table_name, owner) FROM all_tables \
             WHERE owner = {} AND partitioned = 'YES' AND table_name NOT LIKE 'BIN$%'",
            lit(schema)
        );
        self.run_meta(move |c| {
            let set = |name: &str, value: &str| {
                format!("DBMS_METADATA.SET_TRANSFORM_PARAM(DBMS_METADATA.SESSION_TRANSFORM, '{name}', {value});")
            };
            let setup = format!(
                "BEGIN {} {} {} {} END;",
                set("SEGMENT_ATTRIBUTES", "FALSE"),
                set("CONSTRAINTS", "FALSE"),
                set("REF_CONSTRAINTS", "FALSE"),
                set("SQLTERMINATOR", "FALSE"),
            );
            c.execute(&setup, &[]).map_err(|e| e.to_string())?;
            let rows = fetch(c, &sql);
            let reset = format!("BEGIN {} END;", set("DEFAULT", "TRUE"));
            let _ = c.execute(&reset, &[]);
            Ok(rows?
                .iter()
                .map(|r| (s(r, 0), s(r, 1).trim().to_string()))
                .collect())
        })
        .await
    }

    async fn catalog_constraints(
        &self,
        schema: &str,
        tables: &HashSet<String>,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let owner = lit(schema);
        let columns = self
            .rows(format!(
                "SELECT cc.owner, cc.constraint_name, cc.column_name FROM all_cons_columns cc \
                 WHERE (cc.owner, cc.constraint_name) IN ( \
                   SELECT c.owner, c.constraint_name FROM all_constraints c WHERE c.owner = {owner} AND c.constraint_type IN ('P', 'U', 'R') \
                   UNION SELECT c.r_owner, c.r_constraint_name FROM all_constraints c WHERE c.owner = {owner} AND c.constraint_type = 'R') \
                 ORDER BY cc.owner, cc.constraint_name, cc.position"
            ))
            .await?;
        let mut cols: HashMap<(String, String), Vec<String>> = HashMap::new();
        for r in &columns {
            cols.entry((s(r, 0), s(r, 1))).or_default().push(s(r, 2));
        }
        let rows = self
            .rows(format!(
                "SELECT c.table_name, c.constraint_name, c.constraint_type, c.search_condition_vc, c.r_owner, r.table_name, \
                        c.r_constraint_name, c.delete_rule, c.status, c.deferrable, c.deferred, c.generated, c.validated \
                 FROM all_constraints c \
                 LEFT JOIN all_constraints r ON r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name \
                 WHERE c.owner = {owner} AND c.constraint_type IN ('P', 'U', 'R', 'C') AND c.table_name NOT LIKE 'BIN$%' \
                 ORDER BY c.table_name, c.constraint_name"
            ))
            .await?;
        for r in &rows {
            let table = s(r, 0);
            if !tables.contains(&table) {
                continue;
            }
            let name = s(r, 1);
            let kind = s(r, 2);
            let own = || {
                columns_list(
                    cols.get(&(schema.to_string(), name.clone()))
                        .map(Vec::as_slice)
                        .unwrap_or_default(),
                )
            };
            let mut body = match kind.as_str() {
                "P" => format!("PRIMARY KEY ({})", own()),
                "U" => format!("UNIQUE ({})", own()),
                "R" => {
                    let referenced = cols
                        .get(&(s(r, 4), s(r, 6)))
                        .map(Vec::as_slice)
                        .unwrap_or_default();
                    let mut body = format!(
                        "FOREIGN KEY ({}) REFERENCES {}.{} ({})",
                        own(),
                        quote(&s(r, 4)),
                        quote(&s(r, 5)),
                        columns_list(referenced)
                    );
                    match s(r, 7).as_str() {
                        "CASCADE" => body.push_str(" ON DELETE CASCADE"),
                        "SET NULL" => body.push_str(" ON DELETE SET NULL"),
                        _ => {}
                    }
                    body
                }
                _ => {
                    let condition = s(r, 3);
                    if is_not_null_check(&condition) {
                        continue;
                    }
                    format!("CHECK ({})", condition.trim())
                }
            };
            if s(r, 9) == "DEFERRABLE" {
                body.push_str(if s(r, 10) == "DEFERRED" {
                    " DEFERRABLE INITIALLY DEFERRED"
                } else {
                    " DEFERRABLE"
                });
            }
            if s(r, 8) == "DISABLED" {
                body.push_str(" DISABLE");
            } else if s(r, 12) == "NOT VALIDATED" {
                body.push_str(" ENABLE NOVALIDATE");
            }
            let generated = s(r, 11) == "GENERATED NAME";
            let named = if generated {
                String::new()
            } else {
                format!("CONSTRAINT {} ", quote(&name))
            };
            let ddl = format!(
                "ALTER TABLE {}.{} ADD {named}{body}",
                quote(schema),
                quote(&table)
            );
            let mut object = CatalogObject::new("constraint", name, Some(table), ddl)
                .attr("kind", kind.clone())
                .attr("definition", body);
            if generated {
                object = object.attr("generated", "YES");
            }
            if kind == "R" && s(r, 4) == schema {
                object = object.attr("references", s(r, 5));
            }
            out.push(object);
        }
        Ok(())
    }

    async fn catalog_indexes(
        &self,
        schema: &str,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let owner = lit(schema);
        let expressions = self
            .rows(format!(
                "SELECT index_name, column_position, column_expression FROM all_ind_expressions WHERE index_owner = {owner}"
            ))
            .await?;
        let expressions: HashMap<(String, String), String> = expressions
            .iter()
            .map(|r| ((s(r, 0), s(r, 1)), s(r, 2).trim().to_string()))
            .collect();
        let columns = self
            .rows(format!(
                "SELECT index_name, column_name, descend, column_position FROM all_ind_columns \
                 WHERE index_owner = {owner} ORDER BY index_name, column_position"
            ))
            .await?;
        let mut cols: HashMap<String, Vec<String>> = HashMap::new();
        for r in &columns {
            let index = s(r, 0);
            let expression = expressions.get(&(index.clone(), s(r, 3))).cloned();
            let mut part = expression.unwrap_or_else(|| quote(&s(r, 1)));
            if s(r, 2) == "DESC" {
                part.push_str(" DESC");
            }
            cols.entry(index).or_default().push(part);
        }
        let rows = self
            .rows(format!(
                "SELECT i.index_name, i.table_name, i.index_type, i.uniqueness, i.generated, i.ityp_owner, i.ityp_name, \
                        i.parameters, i.partitioned \
                 FROM all_indexes i \
                 WHERE i.owner = {owner} AND i.table_owner = {owner} AND i.index_type NOT IN ('LOB', 'IOT - TOP', 'CLUSTER') \
                 AND i.table_name NOT LIKE 'BIN$%' AND i.index_name NOT LIKE 'BIN$%' AND i.table_type = 'TABLE' \
                 AND i.index_name NOT LIKE 'I\\_SNAP$\\_%' ESCAPE '\\' \
                 AND NOT EXISTS (SELECT 1 FROM all_constraints c WHERE c.owner = i.table_owner AND c.table_name = i.table_name \
                                 AND c.index_name = i.index_name AND c.constraint_type IN ('P', 'U')) \
                 ORDER BY i.index_name"
            ))
            .await?;
        for r in &rows {
            let name = s(r, 0);
            let table = s(r, 1);
            let index_type = s(r, 2);
            let list = cols.get(&name).cloned().unwrap_or_default().join(", ");
            let kind = if s(r, 3) == "UNIQUE" {
                "UNIQUE "
            } else if index_type.contains("BITMAP") {
                "BITMAP "
            } else {
                ""
            };
            let mut body = format!("ON {}.{} ({list})", quote(schema), quote(&table));
            if index_type.contains("DOMAIN") {
                body.push_str(&format!(
                    " INDEXTYPE IS {}.{}",
                    quote(&s(r, 5)),
                    quote(&s(r, 6))
                ));
                let parameters = s(r, 7);
                if !parameters.trim().is_empty() {
                    body.push_str(&format!(" PARAMETERS ({})", lit(parameters.trim())));
                }
            }
            if index_type.ends_with("/REV") {
                body.push_str(" REVERSE");
            }
            if s(r, 8) == "YES" {
                body.push_str(" LOCAL");
            }
            let ddl = format!(
                "CREATE {kind}INDEX {}.{} {body}",
                quote(schema),
                quote(&name)
            );
            let mut object = CatalogObject::new("index", name, Some(table), ddl)
                .attr("definition", format!("{kind}{body}"));
            if s(r, 4) == "Y" {
                object = object.attr("generated", "YES");
            }
            out.push(object);
        }
        Ok(())
    }

    async fn catalog_views(
        &self,
        schema: &str,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let owner = lit(schema);
        let columns = self
            .rows(format!(
                "SELECT c.table_name, c.column_name FROM all_tab_columns c \
                 WHERE c.owner = {owner} AND c.table_name IN (SELECT view_name FROM all_views WHERE owner = {owner}) \
                 ORDER BY c.table_name, c.column_id"
            ))
            .await?;
        let mut cols: HashMap<String, Vec<String>> = HashMap::new();
        for r in &columns {
            cols.entry(s(r, 0)).or_default().push(s(r, 1));
        }
        let rows = self
            .rows(format!(
                "SELECT view_name, text FROM all_views WHERE owner = {owner} AND view_name NOT LIKE 'BIN$%' ORDER BY view_name"
            ))
            .await?;
        for r in &rows {
            let name = s(r, 0);
            let columns = cols.get(&name).cloned().unwrap_or_default();
            let ddl = view_create_script(schema, &name, &columns, None, &s(r, 1));
            out.push(CatalogObject::new("view", name, None, ddl));
        }
        Ok(())
    }

    async fn catalog_mviews(
        &self,
        schema: &str,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let rows = self
            .rows(format!(
                "SELECT mview_name, query, refresh_mode, refresh_method, build_mode, rewrite_enabled \
                 FROM all_mviews WHERE owner = {} ORDER BY mview_name",
                lit(schema)
            ))
            .await?;
        for r in &rows {
            let name = s(r, 0);
            let refresh = if s(r, 3) == "NEVER" {
                "NEVER REFRESH".to_string()
            } else {
                format!("REFRESH {} ON {}", s(r, 3), s(r, 2))
            };
            let build = if s(r, 4) == "DEFERRED" {
                "DEFERRED"
            } else {
                "IMMEDIATE"
            };
            let rewrite = if s(r, 5) == "Y" {
                "\nENABLE QUERY REWRITE"
            } else {
                ""
            };
            let ddl = format!(
                "CREATE MATERIALIZED VIEW {}.{}\nBUILD {build}\n{refresh}{rewrite}\nAS\n{}",
                quote(schema),
                quote(&name),
                s(r, 1).trim().trim_end_matches(';').trim_end()
            );
            out.push(CatalogObject::new("materialized_view", name, None, ddl));
        }
        Ok(())
    }

    async fn catalog_sequences(
        &self,
        schema: &str,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let rows = self
            .rows(format!(
                "SELECT sequence_name, TO_CHAR(min_value), TO_CHAR(max_value), TO_CHAR(increment_by), cycle_flag, \
                        order_flag, TO_CHAR(cache_size), TO_CHAR(last_number) \
                 FROM all_sequences WHERE sequence_owner = {} AND sequence_name NOT LIKE 'ISEQ$$\\_%' ESCAPE '\\' \
                 ORDER BY sequence_name",
                lit(schema)
            ))
            .await?;
        for r in &rows {
            let name = s(r, 0);
            let cache = s(r, 6);
            let cache_sql = if cache == "0" {
                "NOCACHE".to_string()
            } else {
                format!("CACHE {cache}")
            };
            let cycle = if s(r, 4) == "Y" { "CYCLE" } else { "NOCYCLE" };
            let order = if s(r, 5) == "Y" { "ORDER" } else { "NOORDER" };
            let ddl = format!(
                "CREATE SEQUENCE {}.{} START WITH {} INCREMENT BY {} MINVALUE {} MAXVALUE {} {cache_sql} {cycle} {order}",
                quote(schema),
                quote(&name),
                s(r, 7),
                s(r, 3),
                s(r, 1),
                s(r, 2)
            );
            out.push(
                CatalogObject::new("sequence", name, None, ddl)
                    .attr("current", s(r, 7))
                    .attr("increment", s(r, 3))
                    .attr("min", s(r, 1))
                    .attr("max", s(r, 2))
                    .attr("cache", cache_sql)
                    .attr("cycle", cycle)
                    .attr("order", order),
            );
        }
        Ok(())
    }

    async fn catalog_source(
        &self,
        schema: &str,
        kinds: &[(&str, &str)],
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let owner = lit(schema);
        let list = kinds
            .iter()
            .map(|(source, _)| lit(source))
            .collect::<Vec<_>>()
            .join(", ");
        let triggers: HashMap<String, (String, String)> =
            if kinds.iter().any(|(_, k)| *k == "trigger") {
                self.rows(format!(
                "SELECT trigger_name, table_name, status FROM all_triggers WHERE owner = {owner}"
            ))
                .await?
                .iter()
                .map(|r| (s(r, 0), (s(r, 1), s(r, 2))))
                .collect()
            } else {
                HashMap::new()
            };
        let rows = self
            .rows(format!(
                "SELECT name, type, text FROM all_source WHERE owner = {owner} AND type IN ({list}) \
                 AND name NOT LIKE 'BIN$%' AND name NOT LIKE 'SYS\\_PLSQL\\_%' ESCAPE '\\' AND name NOT LIKE 'SYSTP%' \
                 ORDER BY type, name, line"
            ))
            .await?;
        let mut current: Option<(String, String, String)> = None;
        let flush = |entry: Option<(String, String, String)>, out: &mut Vec<CatalogObject>| {
            let Some((name, source_type, text)) = entry else {
                return;
            };
            let Some((_, kind)) = kinds.iter().find(|(source, _)| *source == source_type) else {
                return;
            };
            let ddl = create_script(schema, &name, &source_type, &text)
                .trim_end()
                .to_string();
            let mut object = CatalogObject::new(kind, name.clone(), None, ddl);
            if *kind == "trigger" {
                if let Some((table, status)) = triggers.get(&name) {
                    if !table.is_empty() {
                        object.parent = Some(table.clone());
                    }
                    object = object.attr("status", status.clone());
                }
            }
            out.push(object);
        };
        for r in &rows {
            let (name, source_type, text) = (s(r, 0), s(r, 1), s(r, 2));
            match current.as_mut() {
                Some((n, t, buf)) if *n == name && *t == source_type => buf.push_str(&text),
                _ => {
                    flush(current.take(), out);
                    current = Some((name, source_type, text));
                }
            }
        }
        flush(current.take(), out);
        Ok(())
    }

    async fn catalog_synonyms(
        &self,
        schema: &str,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let rows = self
            .rows(format!(
                "SELECT synonym_name, table_owner, table_name, db_link FROM all_synonyms WHERE owner = {} ORDER BY synonym_name",
                lit(schema)
            ))
            .await?;
        for r in &rows {
            let name = s(r, 0);
            let target_owner = s(r, 1);
            let mut target = if target_owner.is_empty() {
                quote(&s(r, 2))
            } else {
                format!("{}.{}", quote(&target_owner), quote(&s(r, 2)))
            };
            let link = s(r, 3);
            if !link.is_empty() {
                target.push('@');
                target.push_str(&link);
            }
            let ddl = format!(
                "CREATE OR REPLACE SYNONYM {}.{} FOR {target}",
                quote(schema),
                quote(&name)
            );
            out.push(CatalogObject::new("synonym", name, None, ddl));
        }
        Ok(())
    }

    async fn catalog_comments(
        &self,
        schema: &str,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let owner = lit(schema);
        let tables = self
            .rows(format!(
                "SELECT table_name, comments, 'TABLE' FROM all_tab_comments \
                 WHERE owner = {owner} AND comments IS NOT NULL AND table_name NOT LIKE 'BIN$%' \
                 AND table_name NOT IN (SELECT mview_name FROM all_mviews WHERE owner = {owner}) \
                 UNION ALL SELECT mview_name, comments, 'MATERIALIZED VIEW' FROM all_mview_comments \
                 WHERE owner = {owner} AND comments IS NOT NULL ORDER BY 1"
            ))
            .await?;
        for r in &tables {
            let table = s(r, 0);
            let on = s(r, 2);
            let ddl = format!(
                "COMMENT ON {on} {}.{} IS {}",
                quote(schema),
                quote(&table),
                lit(&s(r, 1))
            );
            out.push(CatalogObject::new(
                "comment",
                table.clone(),
                Some(table),
                ddl,
            ));
        }
        let columns = self
            .rows(format!(
                "SELECT table_name, column_name, comments FROM all_col_comments \
                 WHERE owner = {owner} AND comments IS NOT NULL AND table_name NOT LIKE 'BIN$%' ORDER BY table_name, column_name"
            ))
            .await?;
        for r in &columns {
            let table = s(r, 0);
            let column = s(r, 1);
            let ddl = format!(
                "COMMENT ON COLUMN {}.{}.{} IS {}",
                quote(schema),
                quote(&table),
                quote(&column),
                lit(&s(r, 2))
            );
            out.push(CatalogObject::new(
                "comment",
                format!("{table}.{column}"),
                Some(table),
                ddl,
            ));
        }
        Ok(())
    }

    async fn catalog_grants(
        &self,
        schema: &str,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let owner = lit(schema);
        let rows = self
            .rows(format!(
                "SELECT table_name, grantee, privilege, grantable FROM all_tab_privs \
                 WHERE grantor = {owner} AND table_schema = {owner} AND table_name NOT LIKE 'BIN$%' AND type <> 'USER' \
                 ORDER BY table_name, grantee, privilege"
            ))
            .await?;
        for r in &rows {
            let object = s(r, 0);
            let grantee = s(r, 1);
            let privilege = s(r, 2);
            let grantable = s(r, 3) == "YES";
            let ddl = format!(
                "GRANT {privilege} ON {}.{} TO {}{}",
                quote(schema),
                quote(&object),
                quote(&grantee),
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
}

#[cfg(test)]
mod tests {
    use super::{column_type, is_not_null_check, partition_clause};

    #[test]
    fn extracts_partition_clause() {
        let ddl = "CREATE TABLE \"A\".\"E\" (\"SUBPARTITION BY\" NUMBER) \n  PARTITION BY RANGE (\"D\") \n (PARTITION \"P\" VALUES LESS THAN (MAXVALUE) )\n";
        assert_eq!(
            partition_clause(ddl),
            Some("PARTITION BY RANGE (\"D\") \n (PARTITION \"P\" VALUES LESS THAN (MAXVALUE) )")
        );
        assert_eq!(
            partition_clause("CREATE TABLE \"A\".\"E\" (\"X\" NUMBER)"),
            None
        );
    }

    #[test]
    fn formats_oracle_column_types() {
        assert_eq!(
            column_type("VARCHAR2", "", "80", "", "", "20", "C"),
            "VARCHAR2(20 CHAR)"
        );
        assert_eq!(
            column_type("VARCHAR2", "", "20", "", "", "20", "B"),
            "VARCHAR2(20 BYTE)"
        );
        assert_eq!(column_type("NUMBER", "", "22", "", "", "0", ""), "NUMBER");
        assert_eq!(
            column_type("NUMBER", "", "22", "", "0", "0", ""),
            "NUMBER(*,0)"
        );
        assert_eq!(
            column_type("NUMBER", "", "22", "10", "0", "0", ""),
            "NUMBER(10)"
        );
        assert_eq!(
            column_type("NUMBER", "", "22", "12", "2", "0", ""),
            "NUMBER(12,2)"
        );
        assert_eq!(column_type("RAW", "", "16", "", "", "0", ""), "RAW(16)");
        assert_eq!(
            column_type("T_ADDR", "APP", "1", "", "", "0", ""),
            "\"APP\".\"T_ADDR\""
        );
        assert_eq!(
            column_type("XMLTYPE", "SYS", "2000", "", "", "0", ""),
            "XMLTYPE"
        );
    }

    #[test]
    fn detects_generated_not_null_checks() {
        assert!(is_not_null_check("\"ID\" IS NOT NULL"));
        assert!(!is_not_null_check("\"A\" IS NOT NULL AND \"B\" > 0"));
        assert!(!is_not_null_check("amount > 0"));
    }
}
