use std::collections::{BTreeMap, HashMap};
use std::sync::LazyLock;

use mysql_async::Row;

use super::{cell, cell_opt, lit, quote, MysqlAdapter};
use crate::db::schema_catalog::CatalogObject;

type ForeignKeyGroups = BTreeMap<(String, String), (String, String, Vec<String>, Vec<String>)>;

static INTRODUCER: LazyLock<regex::Regex> =
    LazyLock::new(|| regex::Regex::new(r"(^|[^A-Za-z0-9_$`])_[a-z0-9]+'").unwrap());
static INT_WIDTH: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"^(tinyint|smallint|mediumint|int|integer|bigint)\((\d+)\)").unwrap()
});

pub(super) fn clean_expression(value: &str) -> String {
    let unescaped = value.replace("\\'", "'");
    INTRODUCER.replace_all(&unescaped, "$1'").into_owned()
}

pub(super) fn normalize_type(column_type: &str) -> String {
    let lower = column_type.trim().to_string();
    match INT_WIDTH.captures(&lower) {
        Some(caps) if !(&caps[1] == "tinyint" && &caps[2] == "1") => {
            let base = caps[1].to_string();
            format!("{base}{}", &lower[caps[0].len()..])
        }
        _ => lower,
    }
}

fn is_numeric_type(column_type: &str) -> bool {
    let base = column_type.split(['(', ' ']).next().unwrap_or("");
    matches!(
        base,
        "tinyint"
            | "smallint"
            | "mediumint"
            | "int"
            | "integer"
            | "bigint"
            | "decimal"
            | "numeric"
            | "float"
            | "double"
            | "real"
            | "year"
    )
}

pub(super) fn default_expression(
    value: &str,
    extra: &str,
    column_type: &str,
    mariadb: bool,
) -> Option<String> {
    let trimmed = value.trim();
    if mariadb {
        if trimmed.eq_ignore_ascii_case("NULL") {
            return None;
        }
        return Some(clean_expression(trimmed));
    }
    if extra.to_ascii_uppercase().contains("DEFAULT_GENERATED") {
        let expression = clean_expression(trimmed);
        let upper = expression.to_ascii_uppercase();
        if upper.starts_with("CURRENT_TIMESTAMP") || upper.starts_with("NOW(") {
            return Some(expression);
        }
        return Some(format!("({expression})"));
    }
    if trimmed.starts_with("b'") || (is_numeric_type(column_type) && trimmed.parse::<f64>().is_ok())
    {
        return Some(trimmed.to_string());
    }
    Some(lit(value))
}

fn table_name(schema: &str, name: &str) -> String {
    format!("{}.{}", quote(schema), quote(name))
}

struct KeyPart {
    column: Option<String>,
    sub_part: Option<String>,
    descending: bool,
    expression: Option<String>,
}

struct IndexInfo {
    table: String,
    unique: bool,
    kind: String,
    visible: bool,
    parts: Vec<KeyPart>,
}

fn key_parts(parts: &[KeyPart]) -> String {
    parts
        .iter()
        .map(|part| {
            let mut text = match (&part.expression, &part.column) {
                (Some(expression), _) => format!("({})", clean_expression(expression)),
                (None, Some(column)) => quote(column),
                _ => String::new(),
            };
            if let Some(sub) = &part.sub_part {
                text.push_str(&format!("({sub})"));
            }
            if part.descending {
                text.push_str(" DESC");
            }
            text
        })
        .collect::<Vec<_>>()
        .join(", ")
}

impl MysqlAdapter {
    async fn is_mariadb(&self) -> Result<bool, String> {
        Ok(self
            .rows("SELECT VERSION()")
            .await?
            .first()
            .map(|row| cell(row, 0).to_ascii_lowercase().contains("mariadb"))
            .unwrap_or(false))
    }

    pub(super) async fn schema_catalog_impl(
        &self,
        schema: &str,
        types: &[String],
    ) -> Result<Vec<CatalogObject>, String> {
        let want = |kind: &str| types.iter().any(|item| item == kind);
        let mariadb = self.is_mariadb().await?;
        let mut out = Vec::new();
        let tables = want("table");
        let constraints = want("constraint");
        if tables || constraints || want("index") {
            self.catalog_relations(schema, mariadb, types, &mut out)
                .await?;
        }
        if want("view") {
            self.catalog_views(schema, &mut out).await?;
        }
        if want("function") || want("procedure") {
            self.catalog_routines(schema, want("function"), want("procedure"), &mut out)
                .await?;
        }
        if want("trigger") {
            self.catalog_triggers(schema, &mut out).await?;
        }
        Ok(out)
    }

    async fn catalog_relations(
        &self,
        schema: &str,
        mariadb: bool,
        types: &[String],
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let want = |kind: &str| types.iter().any(|item| item == kind);
        let s = lit(schema);
        let table_rows = self
            .rows(&format!(
                "SELECT TABLE_NAME, TABLE_COLLATION FROM information_schema.TABLES \
                 WHERE TABLE_SCHEMA = {s} AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME"
            ))
            .await?;
        let collations: HashMap<String, String> = table_rows
            .iter()
            .map(|row| (cell(row, 0), cell(row, 1)))
            .collect();
        let statistics = self
            .rows(&format!(
                "SELECT TABLE_NAME, INDEX_NAME, NON_UNIQUE, COLUMN_NAME, SUB_PART, COLLATION, INDEX_TYPE, {} \
                 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = {s} \
                 ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX",
                if mariadb {
                    "NULL, 'YES'"
                } else {
                    "EXPRESSION, IS_VISIBLE"
                }
            ))
            .await?;
        let mut indexes: BTreeMap<(String, String), IndexInfo> = BTreeMap::new();
        for row in &statistics {
            let table = cell(row, 0);
            let name = cell(row, 1);
            let entry = indexes
                .entry((table.clone(), name))
                .or_insert_with(|| IndexInfo {
                    table,
                    unique: cell(row, 2) == "0",
                    kind: cell(row, 6),
                    visible: cell(row, 8) != "NO",
                    parts: Vec::new(),
                });
            entry.parts.push(KeyPart {
                column: cell_opt(row, 3),
                sub_part: cell_opt(row, 4),
                descending: cell(row, 5) == "D",
                expression: cell_opt(row, 7),
            });
        }
        let constraint_rows = self
            .rows(&format!(
                "SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS \
                 WHERE TABLE_SCHEMA = {s} ORDER BY TABLE_NAME, CONSTRAINT_NAME"
            ))
            .await?;
        let mut key_constraints = std::collections::HashSet::new();
        let mut primary_keys: HashMap<String, String> = HashMap::new();
        if want("table") {
            for row in &constraint_rows {
                if cell(row, 2) == "PRIMARY KEY" {
                    if let Some(index) = indexes.get(&(cell(row, 0), cell(row, 1))) {
                        primary_keys.insert(cell(row, 0), key_parts(&index.parts));
                    }
                }
            }
            self.catalog_tables(schema, mariadb, &collations, &primary_keys, out)
                .await?;
        }
        for row in &constraint_rows {
            if matches!(cell(row, 2).as_str(), "PRIMARY KEY" | "UNIQUE") {
                key_constraints.insert((cell(row, 0), cell(row, 1)));
            }
        }
        if want("constraint") {
            for row in &constraint_rows {
                let table = cell(row, 0);
                let name = cell(row, 1);
                let target = table_name(schema, &table);
                match cell(row, 2).as_str() {
                    "PRIMARY KEY" => {
                        if let Some(index) = indexes.get(&(table.clone(), name.clone())) {
                            let definition = format!("PRIMARY KEY ({})", key_parts(&index.parts));
                            out.push(
                                CatalogObject::new(
                                    "constraint",
                                    name,
                                    Some(table),
                                    format!("ALTER TABLE {target} ADD {definition}"),
                                )
                                .attr("kind", "P")
                                .attr("definition", definition),
                            );
                        }
                    }
                    "UNIQUE" => {
                        if let Some(index) = indexes.get(&(table.clone(), name.clone())) {
                            let definition = format!("UNIQUE ({})", key_parts(&index.parts));
                            out.push(
                                CatalogObject::new(
                                    "constraint",
                                    name.clone(),
                                    Some(table),
                                    format!(
                                        "ALTER TABLE {target} ADD CONSTRAINT {} {definition}",
                                        quote(&name)
                                    ),
                                )
                                .attr("kind", "U")
                                .attr("definition", definition),
                            );
                        }
                    }
                    _ => {}
                }
            }
            self.catalog_foreign_keys(schema, out).await?;
            self.catalog_checks(schema, mariadb, out).await?;
        }
        if want("index") {
            for ((_, name), index) in &indexes {
                if key_constraints.contains(&(index.table.clone(), name.clone())) {
                    continue;
                }
                let prefix = match index.kind.as_str() {
                    "FULLTEXT" => "FULLTEXT ",
                    "SPATIAL" => "SPATIAL ",
                    _ if index.unique => "UNIQUE ",
                    _ => "",
                };
                let ddl = format!(
                    "CREATE {prefix}INDEX {} ON {} ({}){}",
                    quote(name),
                    table_name(schema, &index.table),
                    key_parts(&index.parts),
                    if index.visible { "" } else { " INVISIBLE" }
                );
                out.push(CatalogObject::new(
                    "index",
                    name.clone(),
                    Some(index.table.clone()),
                    ddl,
                ));
            }
        }
        Ok(())
    }

    async fn catalog_tables(
        &self,
        schema: &str,
        mariadb: bool,
        collations: &HashMap<String, String>,
        primary_keys: &HashMap<String, String>,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let rows = self
            .rows(&format!(
                "SELECT c.TABLE_NAME, c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE, c.COLUMN_DEFAULT, c.EXTRA, \
                        c.GENERATION_EXPRESSION, c.COLLATION_NAME \
                 FROM information_schema.COLUMNS c JOIN information_schema.TABLES t \
                   ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME \
                 WHERE c.TABLE_SCHEMA = {} AND t.TABLE_TYPE = 'BASE TABLE' \
                 ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION",
                lit(schema)
            ))
            .await?;
        let mut by_table: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for table in collations.keys() {
            by_table.entry(table.clone()).or_default();
        }
        for row in &rows {
            let (table, object) = column_object(row, mariadb, collations);
            by_table.entry(table).or_default().push(object.ddl.clone());
            out.push(object);
        }
        for (table, mut columns) in by_table {
            if let Some(key) = primary_keys.get(&table) {
                columns.push(format!("PRIMARY KEY ({key})"));
            }
            out.push(CatalogObject::new(
                "table",
                table.clone(),
                None,
                format!(
                    "CREATE TABLE {} (\n  {}\n)",
                    table_name(schema, &table),
                    columns.join(",\n  ")
                ),
            ));
        }
        Ok(())
    }

    async fn catalog_foreign_keys(
        &self,
        schema: &str,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let s = lit(schema);
        let columns = self
            .rows(&format!(
                "SELECT TABLE_NAME, CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, \
                        REFERENCED_COLUMN_NAME \
                 FROM information_schema.KEY_COLUMN_USAGE \
                 WHERE TABLE_SCHEMA = {s} AND REFERENCED_TABLE_NAME IS NOT NULL \
                 ORDER BY TABLE_NAME, CONSTRAINT_NAME, ORDINAL_POSITION"
            ))
            .await?;
        let rules = self
            .rows(&format!(
                "SELECT TABLE_NAME, CONSTRAINT_NAME, UPDATE_RULE, DELETE_RULE \
                 FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = {s}"
            ))
            .await?;
        let rules: HashMap<(String, String), (String, String)> = rules
            .iter()
            .map(|row| ((cell(row, 0), cell(row, 1)), (cell(row, 2), cell(row, 3))))
            .collect();
        let mut grouped = ForeignKeyGroups::new();
        for row in &columns {
            let entry = grouped
                .entry((cell(row, 0), cell(row, 1)))
                .or_insert_with(|| (cell(row, 3), cell(row, 4), Vec::new(), Vec::new()));
            entry.2.push(quote(&cell(row, 2)));
            entry.3.push(quote(&cell(row, 5)));
        }
        for ((table, name), (ref_schema, ref_table, own, referenced)) in grouped {
            let (update, delete) = rules
                .get(&(table.clone(), name.clone()))
                .cloned()
                .unwrap_or_else(|| ("NO ACTION".into(), "NO ACTION".into()));
            let definition = format!(
                "FOREIGN KEY ({}) REFERENCES {} ({}) ON DELETE {delete} ON UPDATE {update}",
                own.join(", "),
                table_name(&ref_schema, &ref_table),
                referenced.join(", ")
            );
            let mut object = CatalogObject::new(
                "constraint",
                name.clone(),
                Some(table.clone()),
                format!(
                    "ALTER TABLE {} ADD CONSTRAINT {} {definition}",
                    table_name(schema, &table),
                    quote(&name)
                ),
            )
            .attr("kind", "R")
            .attr("definition", definition);
            if system_name(&name, &table, "ibfk") {
                object = object.attr("generated", "YES");
            }
            if ref_schema == schema {
                object = object.attr("references", ref_table);
            }
            out.push(object);
        }
        Ok(())
    }

    async fn catalog_checks(
        &self,
        schema: &str,
        mariadb: bool,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let s = lit(schema);
        let sql = if mariadb {
            format!(
                "SELECT TABLE_NAME, CONSTRAINT_NAME, CHECK_CLAUSE, 'YES' FROM information_schema.CHECK_CONSTRAINTS \
                 WHERE CONSTRAINT_SCHEMA = {s} ORDER BY TABLE_NAME, CONSTRAINT_NAME"
            )
        } else {
            format!(
                "SELECT tc.TABLE_NAME, tc.CONSTRAINT_NAME, cc.CHECK_CLAUSE, tc.ENFORCED \
                 FROM information_schema.TABLE_CONSTRAINTS tc \
                 JOIN information_schema.CHECK_CONSTRAINTS cc \
                   ON cc.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND cc.CONSTRAINT_NAME = tc.CONSTRAINT_NAME \
                 WHERE tc.TABLE_SCHEMA = {s} AND tc.CONSTRAINT_TYPE = 'CHECK' \
                 ORDER BY tc.TABLE_NAME, tc.CONSTRAINT_NAME"
            )
        };
        for row in &self.rows(&sql).await? {
            let table = cell(row, 0);
            let name = cell(row, 1);
            let clause = clean_expression(&cell(row, 2));
            let clause = if clause.starts_with('(') && clause.ends_with(')') {
                clause
            } else {
                format!("({clause})")
            };
            let enforced = if cell(row, 3) == "NO" {
                " NOT ENFORCED"
            } else {
                ""
            };
            let definition = format!("CHECK {clause}{enforced}");
            let mut object = CatalogObject::new(
                "constraint",
                name.clone(),
                Some(table.clone()),
                format!(
                    "ALTER TABLE {} ADD CONSTRAINT {} {definition}",
                    table_name(schema, &table),
                    quote(&name)
                ),
            )
            .attr("kind", "C")
            .attr("definition", definition);
            if system_name(&name, &table, "chk") {
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
        let rows = self
            .rows(&format!(
                "SELECT TABLE_NAME, VIEW_DEFINITION, CHECK_OPTION, SECURITY_TYPE FROM information_schema.VIEWS \
                 WHERE TABLE_SCHEMA = {} ORDER BY TABLE_NAME",
                lit(schema)
            ))
            .await?;
        for row in &rows {
            let name = cell(row, 0);
            let definition = clean_expression(&cell(row, 1));
            let check = match cell(row, 2).as_str() {
                "CASCADED" => " WITH CASCADED CHECK OPTION",
                "LOCAL" => " WITH LOCAL CHECK OPTION",
                _ => "",
            };
            let security = cell(row, 3);
            let ddl = format!(
                "CREATE OR REPLACE SQL SECURITY {security} VIEW {} AS {definition}{check}",
                table_name(schema, &name)
            );
            out.push(CatalogObject::new("view", name, None, ddl));
        }
        Ok(())
    }

    async fn catalog_routines(
        &self,
        schema: &str,
        functions: bool,
        procedures: bool,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let s = lit(schema);
        let routines = self
            .rows(&format!(
                "SELECT ROUTINE_NAME, ROUTINE_TYPE, DTD_IDENTIFIER, ROUTINE_DEFINITION, IS_DETERMINISTIC, \
                        SQL_DATA_ACCESS, SECURITY_TYPE, ROUTINE_COMMENT \
                 FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA = {s} ORDER BY ROUTINE_NAME"
            ))
            .await?;
        let parameters = self
            .rows(&format!(
                "SELECT SPECIFIC_NAME, ROUTINE_TYPE, PARAMETER_MODE, PARAMETER_NAME, DTD_IDENTIFIER \
                 FROM information_schema.PARAMETERS WHERE SPECIFIC_SCHEMA = {s} AND ORDINAL_POSITION > 0 \
                 ORDER BY SPECIFIC_NAME, ORDINAL_POSITION"
            ))
            .await?;
        let mut params: HashMap<(String, String), Vec<String>> = HashMap::new();
        for row in &parameters {
            let routine_type = cell(row, 1);
            let mode = cell_opt(row, 2)
                .filter(|_| routine_type == "PROCEDURE")
                .map(|mode| format!("{mode} "))
                .unwrap_or_default();
            params
                .entry((cell(row, 0), routine_type))
                .or_default()
                .push(format!("{mode}{} {}", quote(&cell(row, 3)), cell(row, 4)));
        }
        for row in &routines {
            let name = cell(row, 0);
            let routine_type = cell(row, 1);
            let function = routine_type == "FUNCTION";
            if (function && !functions) || (!function && !procedures) {
                continue;
            }
            let arguments = params
                .get(&(name.clone(), routine_type.clone()))
                .map(|list| list.join(", "))
                .unwrap_or_default();
            let mut ddl = format!(
                "CREATE {routine_type} {}({arguments})",
                table_name(schema, &name)
            );
            if function {
                ddl.push_str(&format!(" RETURNS {}", cell(row, 2)));
            }
            if cell(row, 4) == "YES" {
                ddl.push_str("\n    DETERMINISTIC");
            }
            ddl.push_str(&format!("\n    {}", cell(row, 5)));
            ddl.push_str(&format!("\n    SQL SECURITY {}", cell(row, 6)));
            let comment = cell(row, 7);
            if !comment.is_empty() {
                ddl.push_str(&format!("\n    COMMENT {}", lit(&comment)));
            }
            ddl.push_str(&format!("\n{}", cell(row, 3).trim_end()));
            out.push(CatalogObject::new(
                if function { "function" } else { "procedure" },
                name,
                None,
                ddl,
            ));
        }
        Ok(())
    }

    async fn catalog_triggers(
        &self,
        schema: &str,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let rows = self
            .rows(&format!(
                "SELECT TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE, ACTION_TIMING, ACTION_STATEMENT \
                 FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = {} \
                 ORDER BY EVENT_OBJECT_TABLE, ACTION_ORDER, TRIGGER_NAME",
                lit(schema)
            ))
            .await?;
        for row in &rows {
            let name = cell(row, 0);
            let table = cell(row, 2);
            let ddl = format!(
                "CREATE TRIGGER {} {} {} ON {} FOR EACH ROW {}",
                table_name(schema, &name),
                cell(row, 3),
                cell(row, 1),
                table_name(schema, &table),
                cell(row, 4).trim_end()
            );
            out.push(CatalogObject::new("trigger", name, Some(table), ddl));
        }
        Ok(())
    }
}

fn system_name(name: &str, table: &str, infix: &str) -> bool {
    name.strip_prefix(&format!("{table}_{infix}_"))
        .is_some_and(|rest| !rest.is_empty() && rest.bytes().all(|b| b.is_ascii_digit()))
}

fn column_object(
    row: &Row,
    mariadb: bool,
    collations: &HashMap<String, String>,
) -> (String, CatalogObject) {
    let table = cell(row, 0);
    let name = cell(row, 1);
    let column_type = normalize_type(&cell(row, 2));
    let nullable = cell(row, 3) == "YES";
    let default = cell_opt(row, 4);
    let extra = cell(row, 5);
    let upper_extra = extra.to_ascii_uppercase();
    let generation = cell_opt(row, 6).filter(|value| !value.trim().is_empty());
    let collation = cell_opt(row, 7).filter(|value| collations.get(&table) != Some(value));
    let mut ddl = format!("{} {column_type}", quote(&name));
    let mut object = CatalogObject::new("column", name, Some(table.clone()), "")
        .attr("type", column_type.clone())
        .attr("nullable", if nullable { "YES" } else { "NO" });
    if let Some(collation) = collation {
        ddl.push_str(&format!(" COLLATE {collation}"));
        object = object.attr("collation", collation);
    }
    if let Some(expression) = generation {
        let storage = if upper_extra.contains("STORED") {
            "STORED"
        } else {
            "VIRTUAL"
        };
        let expression = clean_expression(&expression);
        ddl.push_str(&format!(" GENERATED ALWAYS AS ({expression}) {storage}"));
        object = object.attr("generated", format!("{expression} {storage}"));
    }
    ddl.push_str(if nullable { " NULL" } else { " NOT NULL" });
    if !object.attributes.contains_key("generated") {
        if let Some(default) = default
            .as_deref()
            .and_then(|value| default_expression(value, &extra, &column_type, mariadb))
        {
            ddl.push_str(&format!(" DEFAULT {default}"));
            object = object.attr("default", default);
        }
    }
    if let Some(position) = upper_extra.find("ON UPDATE ") {
        let clause = extra[position..].trim().to_string();
        let clause = clause
            .split_whitespace()
            .take(3)
            .collect::<Vec<_>>()
            .join(" ");
        ddl.push_str(&format!(" {clause}"));
        object = object.attr("on_update", clause);
    }
    if upper_extra.contains("AUTO_INCREMENT") {
        ddl.push_str(" AUTO_INCREMENT");
        object = object.attr("identity", "AUTO_INCREMENT");
    }
    object.ddl = ddl;
    (table, object)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_mysql_expressions_and_types() {
        assert_eq!(
            clean_expression(r"(`st` in (_utf8mb4\'x\',_latin1\'y\'))"),
            "(`st` in ('x','y'))"
        );
        assert_eq!(normalize_type("int(11) unsigned"), "int unsigned");
        assert_eq!(normalize_type("tinyint(1)"), "tinyint(1)");
        assert_eq!(normalize_type("bigint(20)"), "bigint");
        assert_eq!(normalize_type("varchar(20)"), "varchar(20)");
        assert_eq!(
            default_expression("a'b", "", "varchar(10)", false).as_deref(),
            Some("'a''b'")
        );
        assert_eq!(
            default_expression("0", "", "int", false).as_deref(),
            Some("0")
        );
        assert_eq!(
            default_expression("CURRENT_TIMESTAMP", "DEFAULT_GENERATED", "timestamp", false)
                .as_deref(),
            Some("CURRENT_TIMESTAMP")
        );
        assert_eq!(
            default_expression(r"concat(_utf8mb4\'a\')", "DEFAULT_GENERATED", "text", false)
                .as_deref(),
            Some("(concat('a'))")
        );
        assert_eq!(default_expression("NULL", "", "int", true).as_deref(), None);
        assert!(system_name("orders_ibfk_1", "orders", "ibfk"));
        assert!(!system_name("orders_ibfk_x", "orders", "ibfk"));
    }
}
