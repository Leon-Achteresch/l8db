use std::collections::BTreeMap;
use std::sync::LazyLock;

use tiberius::Row;

use super::{int, lit, quote, text, text_opt, MssqlAdapter};
use crate::db::schema_catalog::CatalogObject;

type KeyGroups = BTreeMap<(String, String), (String, String, bool, Vec<String>)>;

static MODULE_HEADER: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(
        r#"(?is)^\s*(?:(?:--[^\n]*\n|/\*.*?\*/)\s*)*CREATE\s+(?:OR\s+ALTER\s+)?(PROCEDURE|PROC|FUNCTION|VIEW|TRIGGER)\s+(?:(?:\[[^\]]+\]|"[^"]+"|[\w@#$]+)\s*\.\s*)?(?:\[[^\]]+\]|"[^"]+"|[\w@#$]+)"#,
    )
    .unwrap()
});

pub(super) fn module_ddl(definition: &str, schema: &str, name: &str) -> String {
    let qualified = format!("{}.{}", quote(schema), quote(name));
    match MODULE_HEADER.captures(definition) {
        Some(caps) => {
            let keyword = caps[1].to_ascii_uppercase();
            let keyword = if keyword == "PROC" {
                "PROCEDURE".to_string()
            } else {
                keyword
            };
            format!(
                "CREATE OR ALTER {keyword} {qualified}{}",
                definition[caps[0].len()..].trim_end()
            )
        }
        None => definition.trim().to_string(),
    }
}

pub(super) fn strip_parens(value: &str) -> String {
    let mut current = value.trim().to_string();
    loop {
        if !(current.starts_with('(') && current.ends_with(')')) {
            return current;
        }
        let bytes = current.as_bytes();
        let mut depth = 0i32;
        let mut quoted = false;
        let mut closes_at_end = true;
        for (index, byte) in bytes.iter().enumerate() {
            if quoted {
                if *byte == b'\'' {
                    quoted = false;
                }
                continue;
            }
            match byte {
                b'\'' => quoted = true,
                b'(' => depth += 1,
                b')' => {
                    depth -= 1;
                    if depth == 0 && index + 1 < bytes.len() {
                        closes_at_end = false;
                        break;
                    }
                }
                _ => {}
            }
        }
        if !closes_at_end {
            return current;
        }
        current = current[1..current.len() - 1].trim().to_string();
    }
}

pub(super) fn format_type(
    name: &str,
    max_length: i64,
    precision: i64,
    scale: i64,
    user_schema: Option<&str>,
) -> String {
    if let Some(schema) = user_schema {
        return format!("{}.{}", quote(schema), quote(name));
    }
    match name {
        "varchar" | "char" | "varbinary" | "binary" => {
            if max_length < 0 {
                format!("{name}(max)")
            } else {
                format!("{name}({max_length})")
            }
        }
        "nvarchar" | "nchar" => {
            if max_length < 0 {
                format!("{name}(max)")
            } else {
                format!("{name}({})", max_length / 2)
            }
        }
        "decimal" | "numeric" => format!("{name}({precision},{scale})"),
        "datetime2" | "time" | "datetimeoffset" => format!("{name}({scale})"),
        "float" if precision != 53 => format!("float({precision})"),
        _ => name.to_string(),
    }
}

fn bool_at(row: &Row, index: usize) -> bool {
    int(row, index) != 0
}

fn qualified(schema: &str, name: &str) -> String {
    format!("{}.{}", quote(schema), quote(name))
}

fn add_constraint(schema: &str, table: &str, name: &str, definition: &str, system: bool) -> String {
    if system {
        format!("ALTER TABLE {} ADD {definition}", qualified(schema, table))
    } else {
        format!(
            "ALTER TABLE {} ADD CONSTRAINT {} {definition}",
            qualified(schema, table),
            quote(name)
        )
    }
}

fn column_object(row: &Row, database_collation: &str) -> (String, CatalogObject) {
    let table = text(row, 0);
    let name = text(row, 1);
    let user_schema = if bool_at(row, 14) {
        Some(text(row, 15))
    } else {
        None
    };
    let data_type = format_type(
        &text(row, 2),
        int(row, 3),
        int(row, 4),
        int(row, 5),
        user_schema.as_deref(),
    );
    let nullable = bool_at(row, 6);
    let collation = text_opt(row, 7).filter(|value| value != database_collation);
    let mut object = CatalogObject::new("column", name.clone(), Some(table.clone()), "")
        .attr("type", data_type.clone())
        .attr("nullable", if nullable { "YES" } else { "NO" });
    let mut ddl = quote(&name);
    if let Some(expression) = text_opt(row, 10) {
        let persisted = bool_at(row, 11);
        ddl.push_str(&format!(" AS {expression}"));
        if persisted {
            ddl.push_str(" PERSISTED");
            if !nullable {
                ddl.push_str(" NOT NULL");
            }
        }
        object = object.attr(
            "generated",
            format!(
                "{}{}",
                strip_parens(&expression),
                if persisted { " PERSISTED" } else { "" }
            ),
        );
        object.attributes.remove("type");
        object.ddl = ddl;
        return (table, object);
    }
    ddl.push_str(&format!(" {data_type}"));
    if let Some(collation) = collation {
        ddl.push_str(&format!(" COLLATE {collation}"));
        object = object.attr("collation", collation);
    }
    if let Some(seed) = text_opt(row, 8) {
        let identity = format!("IDENTITY({seed},{})", text(row, 9));
        ddl.push_str(&format!(" {identity}"));
        object = object.attr("identity", identity);
    }
    ddl.push_str(if nullable { " NULL" } else { " NOT NULL" });
    if let Some(default) = text_opt(row, 12) {
        let default = strip_parens(&default);
        ddl.push_str(&format!(" DEFAULT {default}"));
        object = object.attr("default", default);
    }
    object.ddl = ddl;
    (table, object)
}

impl MssqlAdapter {
    pub(super) async fn schema_catalog_impl(
        &self,
        schema: &str,
        types: &[String],
    ) -> Result<Vec<CatalogObject>, String> {
        let want = |kind: &str| types.iter().any(|item| item == kind);
        let s = lit(schema);
        let mut out = Vec::new();
        if want("table") {
            self.catalog_tables(schema, &s, &mut out).await?;
        }
        if want("constraint") {
            self.catalog_keys(schema, &s, &mut out).await?;
            self.catalog_foreign_keys(schema, &s, &mut out).await?;
            self.catalog_checks(schema, &s, &mut out).await?;
        }
        if want("index") {
            self.catalog_indexes(schema, &s, &mut out).await?;
        }
        let modules: Vec<(&str, &str)> = [
            ("V", "view"),
            ("P", "procedure"),
            ("FN", "function"),
            ("IF", "function"),
            ("TF", "function"),
            ("TR", "trigger"),
        ]
        .into_iter()
        .filter(|(_, kind)| want(kind))
        .collect();
        if !modules.is_empty() {
            self.catalog_modules(schema, &s, &modules, &mut out).await?;
        }
        Ok(out)
    }

    async fn catalog_tables(
        &self,
        schema: &str,
        s: &str,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let tables = self
            .rows(&format!(
                "SELECT t.name, CAST(DATABASEPROPERTYEX(DB_NAME(), 'Collation') AS nvarchar(128)) \
                 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id \
                 WHERE s.name = {s} AND t.is_ms_shipped = 0 ORDER BY t.name"
            ))
            .await?;
        let collation = tables.first().map(|row| text(row, 1)).unwrap_or_default();
        let columns = self
            .rows(&format!(
                "SELECT t.name, c.name, ty.name, CAST(c.max_length AS int), CAST(c.precision AS int), \
                        CAST(c.scale AS int), CAST(c.is_nullable AS int), c.collation_name, \
                        CAST(ic.seed_value AS nvarchar(40)), CAST(ic.increment_value AS nvarchar(40)), \
                        cc.definition, CAST(ISNULL(cc.is_persisted, 0) AS int), dc.definition, NULL, \
                        CAST(ty.is_user_defined AS int), SCHEMA_NAME(ty.schema_id) \
                 FROM sys.tables t JOIN sys.schemas s ON s.schema_id = t.schema_id \
                 JOIN sys.columns c ON c.object_id = t.object_id \
                 JOIN sys.types ty ON ty.user_type_id = c.user_type_id \
                 LEFT JOIN sys.identity_columns ic ON ic.object_id = c.object_id AND ic.column_id = c.column_id \
                 LEFT JOIN sys.computed_columns cc ON cc.object_id = c.object_id AND cc.column_id = c.column_id \
                 LEFT JOIN sys.default_constraints dc ON dc.parent_object_id = c.object_id AND dc.parent_column_id = c.column_id \
                 WHERE s.name = {s} AND t.is_ms_shipped = 0 \
                 ORDER BY t.name, c.column_id"
            ))
            .await?;
        let mut by_table: BTreeMap<String, Vec<String>> = tables
            .iter()
            .map(|row| (text(row, 0), Vec::new()))
            .collect();
        for row in &columns {
            let (table, object) = column_object(row, &collation);
            by_table.entry(table).or_default().push(object.ddl.clone());
            out.push(object);
        }
        for (table, columns) in by_table {
            out.push(CatalogObject::new(
                "table",
                table.clone(),
                None,
                format!(
                    "CREATE TABLE {} (\n  {}\n)",
                    qualified(schema, &table),
                    columns.join(",\n  ")
                ),
            ));
        }
        Ok(())
    }

    async fn catalog_keys(
        &self,
        schema: &str,
        s: &str,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let rows = self
            .rows(&format!(
                "SELECT t.name, kc.name, kc.type, i.type_desc, CAST(kc.is_system_named AS int), c.name, \
                        CAST(ic.is_descending_key AS int) \
                 FROM sys.key_constraints kc \
                 JOIN sys.tables t ON t.object_id = kc.parent_object_id \
                 JOIN sys.schemas s ON s.schema_id = t.schema_id \
                 JOIN sys.indexes i ON i.object_id = kc.parent_object_id AND i.index_id = kc.unique_index_id \
                 JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id AND ic.is_included_column = 0 \
                 JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id \
                 WHERE s.name = {s} ORDER BY t.name, kc.name, ic.key_ordinal"
            ))
            .await?;
        let mut grouped = KeyGroups::new();
        for row in &rows {
            let entry = grouped
                .entry((text(row, 0), text(row, 1)))
                .or_insert_with(|| {
                    (
                        text(row, 2).trim().to_string(),
                        text(row, 3),
                        bool_at(row, 4),
                        Vec::new(),
                    )
                });
            let mut column = quote(&text(row, 5));
            if bool_at(row, 6) {
                column.push_str(" DESC");
            }
            entry.3.push(column);
        }
        for ((table, name), (kind, index_type, system, columns)) in grouped {
            let primary = kind == "PK";
            let definition = format!(
                "{} {index_type} ({})",
                if primary { "PRIMARY KEY" } else { "UNIQUE" },
                columns.join(", ")
            );
            let mut object = CatalogObject::new(
                "constraint",
                name.clone(),
                Some(table.clone()),
                add_constraint(schema, &table, &name, &definition, system),
            )
            .attr("kind", if primary { "P" } else { "U" })
            .attr("definition", definition);
            if system {
                object = object.attr("generated", "YES");
            }
            out.push(object);
        }
        Ok(())
    }

    async fn catalog_foreign_keys(
        &self,
        schema: &str,
        s: &str,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let rows = self
            .rows(&format!(
                "SELECT t.name, fk.name, CAST(fk.is_system_named AS int), pc.name, rs.name, rt.name, rc.name, \
                        fk.delete_referential_action_desc, fk.update_referential_action_desc, CAST(fk.is_disabled AS int) \
                 FROM sys.foreign_keys fk \
                 JOIN sys.tables t ON t.object_id = fk.parent_object_id \
                 JOIN sys.schemas s ON s.schema_id = t.schema_id \
                 JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id = fk.object_id \
                 JOIN sys.columns pc ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id \
                 JOIN sys.tables rt ON rt.object_id = fkc.referenced_object_id \
                 JOIN sys.schemas rs ON rs.schema_id = rt.schema_id \
                 JOIN sys.columns rc ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id \
                 WHERE s.name = {s} ORDER BY t.name, fk.name, fkc.constraint_column_id"
            ))
            .await?;
        type Fk = (
            bool,
            String,
            String,
            String,
            String,
            bool,
            Vec<String>,
            Vec<String>,
        );
        let mut grouped: BTreeMap<(String, String), Fk> = BTreeMap::new();
        for row in &rows {
            let entry = grouped
                .entry((text(row, 0), text(row, 1)))
                .or_insert_with(|| {
                    (
                        bool_at(row, 2),
                        text(row, 4),
                        text(row, 5),
                        text(row, 7).replace('_', " "),
                        text(row, 8).replace('_', " "),
                        bool_at(row, 9),
                        Vec::new(),
                        Vec::new(),
                    )
                });
            entry.6.push(quote(&text(row, 3)));
            entry.7.push(quote(&text(row, 6)));
        }
        for (
            (table, name),
            (system, ref_schema, ref_table, delete, update, disabled, own, other),
        ) in grouped
        {
            let definition = format!(
                "FOREIGN KEY ({}) REFERENCES {} ({}) ON DELETE {delete} ON UPDATE {update}",
                own.join(", "),
                qualified(&ref_schema, &ref_table),
                other.join(", ")
            );
            let mut object = CatalogObject::new(
                "constraint",
                name.clone(),
                Some(table.clone()),
                add_constraint(schema, &table, &name, &definition, system),
            )
            .attr("kind", "R")
            .attr("definition", definition);
            if system {
                object = object.attr("generated", "YES");
            }
            if disabled {
                object = object.attr("status", "DISABLED");
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
        s: &str,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let rows = self
            .rows(&format!(
                "SELECT t.name, cc.name, cc.definition, CAST(cc.is_system_named AS int), CAST(cc.is_disabled AS int) \
                 FROM sys.check_constraints cc \
                 JOIN sys.tables t ON t.object_id = cc.parent_object_id \
                 JOIN sys.schemas s ON s.schema_id = t.schema_id \
                 WHERE s.name = {s} ORDER BY t.name, cc.name"
            ))
            .await?;
        for row in &rows {
            let table = text(row, 0);
            let name = text(row, 1);
            let definition = format!("CHECK ({})", strip_parens(&text(row, 2)));
            let system = bool_at(row, 3);
            let mut object = CatalogObject::new(
                "constraint",
                name.clone(),
                Some(table.clone()),
                add_constraint(schema, &table, &name, &definition, system),
            )
            .attr("kind", "C")
            .attr("definition", definition);
            if system {
                object = object.attr("generated", "YES");
            }
            if bool_at(row, 4) {
                object = object.attr("status", "DISABLED");
            }
            out.push(object);
        }
        Ok(())
    }

    async fn catalog_indexes(
        &self,
        schema: &str,
        s: &str,
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let rows = self
            .rows(&format!(
                "SELECT t.name, i.name, CAST(i.is_unique AS int), i.type_desc, i.filter_definition, c.name, \
                        CAST(ic.is_descending_key AS int), CAST(ic.is_included_column AS int) \
                 FROM sys.indexes i \
                 JOIN sys.tables t ON t.object_id = i.object_id \
                 JOIN sys.schemas s ON s.schema_id = t.schema_id \
                 JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id = i.index_id \
                 JOIN sys.columns c ON c.object_id = ic.object_id AND c.column_id = ic.column_id \
                 WHERE s.name = {s} AND i.is_primary_key = 0 AND i.is_unique_constraint = 0 \
                   AND i.type IN (1, 2) AND i.is_hypothetical = 0 \
                 ORDER BY t.name, i.name, ic.is_included_column, ic.key_ordinal, ic.index_column_id"
            ))
            .await?;
        type Index = (bool, String, Option<String>, Vec<String>, Vec<String>);
        let mut grouped: BTreeMap<(String, String), Index> = BTreeMap::new();
        for row in &rows {
            let entry = grouped
                .entry((text(row, 0), text(row, 1)))
                .or_insert_with(|| {
                    (
                        bool_at(row, 2),
                        text(row, 3),
                        text_opt(row, 4),
                        Vec::new(),
                        Vec::new(),
                    )
                });
            let column = quote(&text(row, 5));
            if bool_at(row, 7) {
                entry.4.push(column);
            } else if bool_at(row, 6) {
                entry.3.push(format!("{column} DESC"));
            } else {
                entry.3.push(column);
            }
        }
        for ((table, name), (unique, kind, filter, keys, included)) in grouped {
            let mut ddl = format!(
                "CREATE {}{kind} INDEX {} ON {} ({})",
                if unique { "UNIQUE " } else { "" },
                quote(&name),
                qualified(schema, &table),
                keys.join(", ")
            );
            if !included.is_empty() {
                ddl.push_str(&format!(" INCLUDE ({})", included.join(", ")));
            }
            if let Some(filter) = filter {
                ddl.push_str(&format!(" WHERE {filter}"));
            }
            out.push(CatalogObject::new("index", name, Some(table), ddl));
        }
        Ok(())
    }

    async fn catalog_modules(
        &self,
        schema: &str,
        s: &str,
        modules: &[(&str, &str)],
        out: &mut Vec<CatalogObject>,
    ) -> Result<(), String> {
        let list = modules
            .iter()
            .map(|(code, _)| format!("'{code}'"))
            .collect::<Vec<_>>()
            .join(", ");
        let rows = self
            .rows(&format!(
                "SELECT o.name, RTRIM(o.type), m.definition, OBJECT_NAME(o.parent_object_id), \
                        CAST(ISNULL(OBJECTPROPERTY(o.object_id, 'ExecIsTriggerDisabled'), 0) AS int) \
                 FROM sys.objects o \
                 JOIN sys.schemas s ON s.schema_id = o.schema_id \
                 JOIN sys.sql_modules m ON m.object_id = o.object_id \
                 WHERE s.name = {s} AND o.is_ms_shipped = 0 AND o.type IN ({list}) \
                 ORDER BY o.type, o.name"
            ))
            .await?;
        for row in &rows {
            let name = text(row, 0);
            let code = text(row, 1);
            let Some((_, kind)) = modules.iter().find(|(item, _)| *item == code) else {
                continue;
            };
            let ddl = module_ddl(&text(row, 2), schema, &name);
            let object = if *kind == "trigger" {
                CatalogObject::new("trigger", name, text_opt(row, 3), ddl).attr(
                    "status",
                    if bool_at(row, 4) {
                        "DISABLED"
                    } else {
                        "ENABLED"
                    },
                )
            } else {
                CatalogObject::new(kind, name, None, ddl)
            };
            out.push(object);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_sql_server_catalog_text() {
        assert_eq!(strip_parens("((0))"), "0");
        assert_eq!(strip_parens("(getdate())"), "getdate()");
        assert_eq!(strip_parens("('a)(b')"), "'a)(b'");
        assert_eq!(strip_parens("((1)+(2))"), "(1)+(2)");
        assert_eq!(strip_parens("(1)+(2)"), "(1)+(2)");
        assert_eq!(format_type("nvarchar", 40, 0, 0, None), "nvarchar(20)");
        assert_eq!(format_type("varbinary", -1, 0, 0, None), "varbinary(max)");
        assert_eq!(format_type("decimal", 9, 12, 2, None), "decimal(12,2)");
        assert_eq!(format_type("float", 8, 53, 0, None), "float");
        assert_eq!(
            module_ddl(
                "-- note\nCREATE PROC dbo.purge @d int AS DELETE FROM dbo.t\n",
                "app",
                "purge"
            ),
            "CREATE OR ALTER PROCEDURE [app].[purge] @d int AS DELETE FROM dbo.t"
        );
        assert_eq!(
            module_ddl("create view [x].[v] as select 1 a", "x", "v"),
            "CREATE OR ALTER VIEW [x].[v] as select 1 a"
        );
    }
}
