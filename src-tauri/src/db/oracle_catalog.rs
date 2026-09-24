use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::future::Future;

use futures_util::future::try_join_all;
use oracle::Row;

use super::{create_script, fetch, lit, quote, s, view_create_script, OracleAdapter};
use crate::db::schema_catalog::CatalogObject;

const SYSTEM_TYPE_OWNERS: [&str; 6] = ["SYS", "PUBLIC", "MDSYS", "XDB", "CTXSYS", "ORDSYS"];

type Objects = Result<Vec<CatalogObject>, String>;

async fn when(enabled: bool, load: impl Future<Output = Objects>) -> Objects {
    if enabled {
        load.await
    } else {
        Ok(Vec::new())
    }
}

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

fn table_objects(
    schema: &str,
    meta: &[Row],
    columns: &[CatalogObject],
    primary_keys: &HashMap<String, String>,
) -> Vec<CatalogObject> {
    let mut by_table: HashMap<&str, Vec<String>> = HashMap::new();
    for column in columns {
        if let Some(table) = column.parent.as_deref() {
            by_table.entry(table).or_default().push(column.ddl.clone());
        }
    }
    meta.iter()
        .map(|r| {
            let table = s(r, 0);
            let temporary = s(r, 1) == "Y";
            let mut columns = by_table.remove(table.as_str()).unwrap_or_default();
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
            let mut object = CatalogObject::new("table", table, None, ddl);
            if temporary {
                object = object.attr("temporary", s(r, 2));
            }
            if s(r, 3) == "YES" {
                object = object.attr("partitioned", "YES");
            }
            if s(r, 4) == "IOT" {
                object = object.attr("organization", "INDEX");
            }
            object
        })
        .collect()
}

impl OracleAdapter {
    pub(super) async fn schema_catalog_impl(&self, schema: &str, types: &[String]) -> Objects {
        let want = |kind: &str| types.iter().any(|item| item == kind);
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
        let (relations, views, mviews, sequences, source, synonyms, comments, grants) = tokio::try_join!(
            self.catalog_relations(schema, want("table"), want("constraint"), want("index")),
            when(want("view"), self.catalog_views(schema)),
            when(want("materialized_view"), self.catalog_mviews(schema)),
            when(want("sequence"), self.catalog_sequences(schema)),
            when(!code.is_empty(), self.catalog_source(schema, &code)),
            when(want("synonym"), self.catalog_synonyms(schema)),
            when(want("comment"), self.catalog_comments(schema)),
            when(want("grant"), self.catalog_grants(schema)),
        )?;
        Ok([
            relations, views, mviews, sequences, source, synonyms, comments, grants,
        ]
        .into_iter()
        .flatten()
        .collect())
    }

    pub(super) async fn schema_partition_ddl_impl(
        &self,
        schema: &str,
        tables: &[String],
    ) -> Result<BTreeMap<String, String>, String> {
        let size = tables.len().div_ceil(3).clamp(1, 500);
        let parts = try_join_all(tables.chunks(size).map(|chunk| {
            let sql = format!(
                "SELECT table_name, DBMS_METADATA.GET_DDL('TABLE', table_name, owner) FROM all_tables \
                 WHERE owner = {} AND partitioned = 'YES' AND table_name IN ({})",
                lit(schema),
                chunk.iter().map(|table| lit(table)).collect::<Vec<_>>().join(", ")
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
                let rows = c
                    .execute(&setup, &[])
                    .map_err(|e| e.to_string())
                    .and_then(|_| fetch(c, &sql));
                let reset = format!("BEGIN {} END;", set("DEFAULT", "TRUE"));
                c.execute(&reset, &[]).map_err(|e| e.to_string())?;
                Ok(rows?
                    .iter()
                    .map(|r| (s(r, 0), s(r, 1)))
                    .collect::<Vec<_>>())
            })
        }))
        .await?;
        Ok(parts
            .into_iter()
            .flatten()
            .filter_map(|(table, ddl)| Some((table, partition_clause(&ddl)?.to_string())))
            .collect())
    }

    async fn catalog_relations(
        &self,
        schema: &str,
        tables_wanted: bool,
        constraints_wanted: bool,
        indexes_wanted: bool,
    ) -> Objects {
        if !(tables_wanted || constraints_wanted || indexes_wanted) {
            return Ok(Vec::new());
        }
        let (meta, (mut constraints, backing), mut columns, mut indexes) = tokio::try_join!(
            self.catalog_table_meta(schema),
            self.catalog_constraints(schema),
            when(tables_wanted, self.catalog_columns(schema)),
            when(indexes_wanted, self.catalog_indexes(schema)),
        )?;
        let tables: HashSet<String> = meta.iter().map(|r| s(r, 0)).collect();
        let in_tables = |object: &CatalogObject| {
            object
                .parent
                .as_ref()
                .is_some_and(|table| tables.contains(table))
        };
        constraints.retain(in_tables);
        columns.retain(in_tables);
        indexes.retain(|index| !backing.contains(&index.name));
        let mut out = Vec::new();
        if tables_wanted {
            let primary_keys: HashMap<String, String> = constraints
                .iter()
                .filter(|c| c.attributes.get("kind").is_some_and(|kind| kind == "P"))
                .filter_map(|c| {
                    let table = c.parent.clone()?;
                    let prefix = format!("ALTER TABLE {}.{} ADD ", quote(schema), quote(&table));
                    Some((table, c.ddl.strip_prefix(&prefix)?.to_string()))
                })
                .collect();
            out.extend(table_objects(schema, &meta, &columns, &primary_keys));
            out.extend(columns);
        }
        if constraints_wanted {
            out.extend(constraints);
        }
        out.extend(indexes);
        Ok(out)
    }

    async fn catalog_table_meta(&self, schema: &str) -> Result<Vec<Row>, String> {
        let owner = lit(schema);
        let rows = self
            .rows(format!(
                "SELECT table_name, temporary, duration, partitioned, iot_type, 'T' FROM all_tables \
                 WHERE owner = {owner} AND nested = 'NO' AND secondary = 'N' AND dropped = 'NO' \
                 AND (iot_type IS NULL OR iot_type = 'IOT') \
                 AND table_name NOT LIKE 'BIN$%' AND table_name NOT LIKE 'MLOG$\\_%' ESCAPE '\\' \
                 AND table_name NOT LIKE 'RUPD$\\_%' ESCAPE '\\' AND table_name NOT LIKE 'AQ$%' \
                 UNION ALL SELECT container_name, NULL, NULL, NULL, NULL, 'X' FROM all_mviews WHERE owner = {owner} \
                 UNION ALL SELECT table_name, NULL, NULL, NULL, NULL, 'X' FROM all_external_tables WHERE owner = {owner}"
            ))
            .await?;
        let excluded: HashSet<String> = rows
            .iter()
            .filter(|r| s(r, 5) == "X")
            .map(|r| s(r, 0))
            .collect();
        Ok(rows
            .into_iter()
            .filter(|r| s(r, 5) == "T" && !excluded.contains(&s(r, 0)))
            .collect())
    }

    async fn catalog_columns(&self, schema: &str) -> Objects {
        let rows = self
            .rows(format!(
                "SELECT c.table_name, c.column_name, c.data_type, c.data_type_owner, c.data_length, c.data_precision, \
                        c.data_scale, c.char_length, c.char_used, c.nullable, c.data_default, c.virtual_column, \
                        c.default_on_null, ic.generation_type \
                 FROM all_tab_cols c \
                 LEFT JOIN all_tab_identity_cols ic ON ic.owner = c.owner AND ic.table_name = c.table_name AND ic.column_name = c.column_name \
                 WHERE c.owner = {} AND c.hidden_column = 'NO' AND c.table_name NOT LIKE 'BIN$%' \
                 ORDER BY c.table_name, c.column_id",
                lit(schema)
            ))
            .await?;
        Ok(rows
            .iter()
            .map(|r| {
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
                let on_null = s(r, 12) == "YES";
                let identity = s(r, 13);
                let mut ddl = format!("{} {data_type}", quote(&name));
                let mut object = CatalogObject::new("column", name, Some(s(r, 0)), "")
                    .attr("type", data_type)
                    .attr("nullable", if nullable == "N" { "NO" } else { "YES" });
                if s(r, 11) == "YES" {
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
                object.ddl = ddl;
                object
            })
            .collect())
    }

    async fn catalog_constraints(
        &self,
        schema: &str,
    ) -> Result<(Vec<CatalogObject>, HashSet<String>), String> {
        let owner = lit(schema);
        let (mut columns, rows) = tokio::try_join!(
            self.rows(format!(
                "SELECT owner, constraint_name, table_name, column_name FROM all_cons_columns \
                 WHERE owner = {owner} ORDER BY constraint_name, position"
            )),
            self.rows(format!(
                "SELECT table_name, constraint_name, constraint_type, search_condition_vc, r_owner, r_constraint_name, \
                        delete_rule, status, deferrable, deferred, generated, validated, index_owner, index_name \
                 FROM all_constraints \
                 WHERE owner = {owner} AND constraint_type IN ('P', 'U', 'R', 'C') AND table_name NOT LIKE 'BIN$%' \
                 ORDER BY table_name, constraint_name"
            )),
        )?;
        let foreign: Vec<String> = rows
            .iter()
            .filter(|r| s(r, 2) == "R" && s(r, 4) != schema)
            .map(|r| format!("({}, {})", lit(&s(r, 4)), lit(&s(r, 5))))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        for chunk in try_join_all(foreign.chunks(500).map(|chunk| {
            self.rows(format!(
                "SELECT owner, constraint_name, table_name, column_name FROM all_cons_columns \
                 WHERE (owner, constraint_name) IN ({}) ORDER BY constraint_name, position",
                chunk.join(", ")
            ))
        }))
        .await?
        {
            columns.extend(chunk);
        }
        let mut cols: HashMap<(String, String), (String, Vec<String>)> = HashMap::new();
        for r in &columns {
            cols.entry((s(r, 0), s(r, 1)))
                .or_insert_with(|| (s(r, 2), Vec::new()))
                .1
                .push(s(r, 3));
        }
        let mut out = Vec::new();
        let mut backing = HashSet::new();
        for r in &rows {
            let table = s(r, 0);
            let name = s(r, 1);
            let kind = s(r, 2);
            if matches!(kind.as_str(), "P" | "U") && s(r, 12) == schema {
                backing.insert(s(r, 13));
            }
            let own = || {
                columns_list(
                    cols.get(&(schema.to_string(), name.clone()))
                        .map(|(_, columns)| columns.as_slice())
                        .unwrap_or_default(),
                )
            };
            let referenced = cols.get(&(s(r, 4), s(r, 5)));
            let referenced_table = referenced
                .map(|(table, _)| table.clone())
                .unwrap_or_default();
            let mut body = match kind.as_str() {
                "P" => format!("PRIMARY KEY ({})", own()),
                "U" => format!("UNIQUE ({})", own()),
                "R" => {
                    let mut body = format!(
                        "FOREIGN KEY ({}) REFERENCES {}.{} ({})",
                        own(),
                        quote(&s(r, 4)),
                        quote(&referenced_table),
                        columns_list(
                            referenced
                                .map(|(_, columns)| columns.as_slice())
                                .unwrap_or_default()
                        )
                    );
                    match s(r, 6).as_str() {
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
            if s(r, 8) == "DEFERRABLE" {
                body.push_str(if s(r, 9) == "DEFERRED" {
                    " DEFERRABLE INITIALLY DEFERRED"
                } else {
                    " DEFERRABLE"
                });
            }
            if s(r, 7) == "DISABLED" {
                body.push_str(" DISABLE");
            } else if s(r, 11) == "NOT VALIDATED" {
                body.push_str(" ENABLE NOVALIDATE");
            }
            let generated = s(r, 10) == "GENERATED NAME";
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
                object = object.attr("references", referenced_table);
            }
            out.push(object);
        }
        Ok((out, backing))
    }

    async fn catalog_indexes(&self, schema: &str) -> Objects {
        let owner = lit(schema);
        let (expressions, columns, rows) = tokio::try_join!(
            self.rows(format!(
                "SELECT index_name, column_position, column_expression FROM all_ind_expressions WHERE index_owner = {owner}"
            )),
            self.rows(format!(
                "SELECT index_name, column_name, descend, column_position FROM all_ind_columns \
                 WHERE index_owner = {owner} ORDER BY index_name, column_position"
            )),
            self.rows(format!(
                "SELECT index_name, table_name, index_type, uniqueness, generated, ityp_owner, ityp_name, \
                        parameters, partitioned \
                 FROM all_indexes \
                 WHERE owner = {owner} AND table_owner = {owner} AND index_type NOT IN ('LOB', 'IOT - TOP', 'CLUSTER') \
                 AND table_name NOT LIKE 'BIN$%' AND index_name NOT LIKE 'BIN$%' AND table_type = 'TABLE' \
                 AND index_name NOT LIKE 'I\\_SNAP$\\_%' ESCAPE '\\' \
                 ORDER BY index_name"
            )),
        )?;
        let expressions: HashMap<(String, String), String> = expressions
            .iter()
            .map(|r| ((s(r, 0), s(r, 1)), s(r, 2).trim().to_string()))
            .collect();
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
        let mut out = Vec::new();
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
        Ok(out)
    }

    async fn catalog_views(&self, schema: &str) -> Objects {
        let owner = lit(schema);
        let (columns, rows) = tokio::try_join!(
            self.rows(format!(
                "SELECT c.table_name, c.column_name FROM all_tab_columns c \
                 WHERE c.owner = {owner} AND c.table_name IN (SELECT view_name FROM all_views WHERE owner = {owner}) \
                 ORDER BY c.table_name, c.column_id"
            )),
            self.rows(format!(
                "SELECT view_name, text FROM all_views WHERE owner = {owner} AND view_name NOT LIKE 'BIN$%' ORDER BY view_name"
            )),
        )?;
        let mut cols: HashMap<String, Vec<String>> = HashMap::new();
        for r in &columns {
            cols.entry(s(r, 0)).or_default().push(s(r, 1));
        }
        Ok(rows
            .iter()
            .map(|r| {
                let name = s(r, 0);
                let columns = cols.get(&name).cloned().unwrap_or_default();
                let ddl = view_create_script(schema, &name, &columns, None, &s(r, 1));
                CatalogObject::new("view", name, None, ddl)
            })
            .collect())
    }

    async fn catalog_mviews(&self, schema: &str) -> Objects {
        let mut out = Vec::new();
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
        Ok(out)
    }

    async fn catalog_sequences(&self, schema: &str) -> Objects {
        let mut out = Vec::new();
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
        Ok(out)
    }

    async fn catalog_source(&self, schema: &str, kinds: &[(&str, &str)]) -> Objects {
        let mut out = Vec::new();
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
                    flush(current.take(), &mut out);
                    current = Some((name, source_type, text));
                }
            }
        }
        flush(current.take(), &mut out);
        Ok(out)
    }

    async fn catalog_synonyms(&self, schema: &str) -> Objects {
        let mut out = Vec::new();
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
        Ok(out)
    }

    async fn catalog_comments(&self, schema: &str) -> Objects {
        let mut out = Vec::new();
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
        Ok(out)
    }

    async fn catalog_grants(&self, schema: &str) -> Objects {
        let mut out = Vec::new();
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
        Ok(out)
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
