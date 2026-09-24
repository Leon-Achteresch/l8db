use super::{mssql, mysql, quote_ident, unsupported, CreateTableRequest, DatabaseKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TableConstraint {
    PrimaryKey {
        #[serde(default)]
        name: Option<String>,
        columns: Vec<String>,
    },
    Unique {
        #[serde(default)]
        name: Option<String>,
        columns: Vec<String>,
    },
    Check {
        #[serde(default)]
        name: Option<String>,
        expression: String,
    },
    ForeignKey {
        #[serde(default)]
        name: Option<String>,
        columns: Vec<String>,
        #[serde(default)]
        ref_schema: Option<String>,
        ref_table: String,
        ref_columns: Vec<String>,
        #[serde(default)]
        on_delete: Option<String>,
        #[serde(default)]
        on_update: Option<String>,
        #[serde(default)]
        deferrable: bool,
        #[serde(default)]
        initially_deferred: bool,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "action", rename_all = "snake_case")]
pub enum ConstraintChange {
    Add {
        constraint: TableConstraint,
    },
    Drop {
        name: String,
        constraint_type: String,
    },
}

#[derive(Debug, Clone, Serialize)]
pub struct ColumnValueOptions {
    pub column: String,
    pub values: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConstraintDialect {
    Postgres,
    Mysql,
    Sqlite,
    Mssql,
    Oracle,
    Duckdb,
}

const ALL_ACTIONS: &[&str] = &[
    "NO ACTION",
    "RESTRICT",
    "CASCADE",
    "SET NULL",
    "SET DEFAULT",
];

impl ConstraintDialect {
    pub fn from_kind(kind: DatabaseKind) -> Option<Self> {
        match kind {
            DatabaseKind::Postgres => Some(Self::Postgres),
            DatabaseKind::Mysql => Some(Self::Mysql),
            DatabaseKind::Sqlite => Some(Self::Sqlite),
            DatabaseKind::Mssql => Some(Self::Mssql),
            DatabaseKind::Oracle => Some(Self::Oracle),
            DatabaseKind::Duckdb => Some(Self::Duckdb),
            _ => None,
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Postgres => "PostgreSQL",
            Self::Mysql => "MySQL/MariaDB",
            Self::Sqlite => "SQLite",
            Self::Mssql => "SQL Server",
            Self::Oracle => "Oracle",
            Self::Duckdb => "DuckDB",
        }
    }

    pub fn quote(self, ident: &str) -> String {
        match self {
            Self::Mysql => mysql::quote(ident),
            Self::Mssql => mssql::quote(ident),
            _ => quote_ident(ident),
        }
    }

    fn actions(self, on_update: bool) -> &'static [&'static str] {
        match self {
            Self::Postgres | Self::Sqlite => ALL_ACTIONS,
            Self::Mysql => &["NO ACTION", "RESTRICT", "CASCADE", "SET NULL"],
            Self::Mssql => &["NO ACTION", "CASCADE", "SET NULL", "SET DEFAULT"],
            Self::Oracle if on_update => &["NO ACTION"],
            Self::Oracle => &["NO ACTION", "CASCADE", "SET NULL"],
            Self::Duckdb => &["NO ACTION"],
        }
    }

    fn supports_deferrable(self) -> bool {
        matches!(self, Self::Postgres | Self::Oracle | Self::Sqlite)
    }

    fn supports_alter(self) -> bool {
        !matches!(self, Self::Sqlite | Self::Duckdb)
    }
}

fn clean_name(name: &Option<String>) -> Option<&str> {
    name.as_deref().map(str::trim).filter(|n| !n.is_empty())
}

fn column_list(
    dialect: ConstraintDialect,
    columns: &[String],
    what: &str,
) -> Result<String, String> {
    if columns.is_empty() {
        return Err(format!("{what}: mindestens eine Spalte wählen."));
    }
    let mut seen: Vec<&str> = Vec::with_capacity(columns.len());
    for column in columns {
        let column = column.trim();
        if column.is_empty() {
            return Err(format!("{what}: leerer Spaltenname."));
        }
        if seen.contains(&column) {
            return Err(format!(
                "{what}: Spalte \"{column}\" ist doppelt angegeben."
            ));
        }
        seen.push(column);
    }
    Ok(seen
        .iter()
        .map(|c| dialect.quote(c))
        .collect::<Vec<_>>()
        .join(", "))
}

fn action_clause(
    dialect: ConstraintDialect,
    action: &Option<String>,
    on_update: bool,
) -> Result<String, String> {
    let Some(raw) = action.as_deref().map(str::trim).filter(|a| !a.is_empty()) else {
        return Ok(String::new());
    };
    let normalized = raw
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_uppercase();
    let event = if on_update { "ON UPDATE" } else { "ON DELETE" };
    if !ALL_ACTIONS.contains(&normalized.as_str()) {
        return Err(format!("Unbekannte Aktion für {event}: {raw}"));
    }
    if !dialect.actions(on_update).contains(&normalized.as_str()) {
        return Err(format!(
            "{event} {normalized} wird von {} nicht unterstützt.",
            dialect.label()
        ));
    }
    if normalized == "NO ACTION" {
        return Ok(String::new());
    }
    Ok(format!(" {event} {normalized}"))
}

pub fn constraint_clause(
    dialect: ConstraintDialect,
    constraint: &TableConstraint,
) -> Result<String, String> {
    let prefix = |name: &Option<String>| {
        clean_name(name)
            .map(|n| format!("CONSTRAINT {} ", dialect.quote(n)))
            .unwrap_or_default()
    };
    match constraint {
        TableConstraint::PrimaryKey { name, columns } => Ok(format!(
            "{}PRIMARY KEY ({})",
            prefix(name),
            column_list(dialect, columns, "Primärschlüssel")?
        )),
        TableConstraint::Unique { name, columns } => Ok(format!(
            "{}UNIQUE ({})",
            prefix(name),
            column_list(dialect, columns, "Unique-Constraint")?
        )),
        TableConstraint::Check { name, expression } => {
            let expression = expression.trim().trim_end_matches(';').trim();
            if expression.is_empty() {
                return Err("CHECK-Constraint: Ausdruck fehlt.".to_string());
            }
            Ok(format!("{}CHECK ({expression})", prefix(name)))
        }
        TableConstraint::ForeignKey {
            name,
            columns,
            ref_schema,
            ref_table,
            ref_columns,
            on_delete,
            on_update,
            deferrable,
            initially_deferred,
        } => {
            let local = column_list(dialect, columns, "Fremdschlüssel")?;
            let ref_table = ref_table.trim();
            if ref_table.is_empty() {
                return Err("Fremdschlüssel: referenzierte Tabelle fehlt.".to_string());
            }
            let referenced = column_list(dialect, ref_columns, "Fremdschlüssel (Ziel)")?;
            if columns.len() != ref_columns.len() {
                return Err(format!(
                    "Fremdschlüssel: {} lokale, aber {} referenzierte Spalten.",
                    columns.len(),
                    ref_columns.len()
                ));
            }
            let target = match clean_name(ref_schema) {
                Some(schema) if dialect != ConstraintDialect::Sqlite => {
                    format!("{}.{}", dialect.quote(schema), dialect.quote(ref_table))
                }
                _ => dialect.quote(ref_table),
            };
            let mut sql = format!(
                "{}FOREIGN KEY ({local}) REFERENCES {target} ({referenced}){}{}",
                prefix(name),
                action_clause(dialect, on_delete, false)?,
                action_clause(dialect, on_update, true)?,
            );
            if *initially_deferred && !*deferrable {
                return Err("INITIALLY DEFERRED setzt DEFERRABLE voraus.".to_string());
            }
            if *deferrable {
                if !dialect.supports_deferrable() {
                    return Err(format!(
                        "DEFERRABLE wird von {} nicht unterstützt.",
                        dialect.label()
                    ));
                }
                sql.push_str(if *initially_deferred {
                    " DEFERRABLE INITIALLY DEFERRED"
                } else {
                    " DEFERRABLE INITIALLY IMMEDIATE"
                });
            }
            Ok(sql)
        }
    }
}

pub fn table_clauses(
    dialect: ConstraintDialect,
    req: &CreateTableRequest,
) -> Result<Vec<String>, String> {
    let column_pk = req.columns.iter().any(|c| c.is_primary_key);
    let mut primary_keys = usize::from(column_pk);
    let mut clauses = Vec::with_capacity(req.constraints.len());
    for constraint in &req.constraints {
        if matches!(constraint, TableConstraint::PrimaryKey { .. }) {
            primary_keys += 1;
        }
        if let TableConstraint::PrimaryKey { columns, .. }
        | TableConstraint::Unique { columns, .. }
        | TableConstraint::ForeignKey { columns, .. } = constraint
        {
            if let Some(missing) = columns
                .iter()
                .find(|c| !req.columns.iter().any(|col| col.name == c.trim()))
            {
                return Err(format!(
                    "Constraint verweist auf unbekannte Spalte \"{missing}\"."
                ));
            }
        }
        clauses.push(constraint_clause(dialect, constraint)?);
    }
    if primary_keys > 1 {
        return Err("Eine Tabelle kann nur einen Primärschlüssel haben.".to_string());
    }
    Ok(clauses)
}

fn table_target(dialect: ConstraintDialect, schema: &str, table: &str) -> String {
    if schema.trim().is_empty() {
        dialect.quote(table)
    } else {
        format!("{}.{}", dialect.quote(schema), dialect.quote(table))
    }
}

pub fn change_sql(
    dialect: ConstraintDialect,
    schema: &str,
    table: &str,
    change: &ConstraintChange,
) -> Result<String, String> {
    if table.trim().is_empty() {
        return Err("Tabellenname fehlt.".to_string());
    }
    if !dialect.supports_alter() {
        return Err(format!(
            "{} kann Constraints bestehender Tabellen nicht per ALTER TABLE ändern. Constraints beim Anlegen der Tabelle definieren oder die Tabelle neu aufbauen (neue Tabelle anlegen, Daten kopieren, alte Tabelle ersetzen).",
            dialect.label()
        ));
    }
    let target = table_target(dialect, schema, table);
    match change {
        ConstraintChange::Add { constraint } => Ok(format!(
            "ALTER TABLE {target} ADD {}",
            constraint_clause(dialect, constraint)?
        )),
        ConstraintChange::Drop {
            name,
            constraint_type,
        } => {
            let name = name.trim();
            let kind = constraint_type.trim().to_uppercase();
            if dialect == ConstraintDialect::Mysql {
                return Ok(match kind.as_str() {
                    "PRIMARY KEY" => format!("ALTER TABLE {target} DROP PRIMARY KEY"),
                    _ if name.is_empty() => {
                        return Err("Constraint-Name fehlt.".to_string());
                    }
                    "FOREIGN KEY" => {
                        format!(
                            "ALTER TABLE {target} DROP FOREIGN KEY {}",
                            dialect.quote(name)
                        )
                    }
                    "UNIQUE" => format!("ALTER TABLE {target} DROP INDEX {}", dialect.quote(name)),
                    _ => format!(
                        "ALTER TABLE {target} DROP CONSTRAINT {}",
                        dialect.quote(name)
                    ),
                });
            }
            if name.is_empty() {
                return Err("Constraint-Name fehlt.".to_string());
            }
            Ok(format!(
                "ALTER TABLE {target} DROP CONSTRAINT {}",
                dialect.quote(name)
            ))
        }
    }
}

pub fn preview_change(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    change: &ConstraintChange,
) -> Result<String, String> {
    let dialect = ConstraintDialect::from_kind(kind).ok_or_else(|| unsupported("Constraints"))?;
    change_sql(dialect, schema, table, change)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ColumnDefinition;

    fn fk(on_delete: Option<&str>, on_update: Option<&str>, deferrable: bool) -> TableConstraint {
        TableConstraint::ForeignKey {
            name: Some("fk_order_customer".to_string()),
            columns: vec!["customer_id".to_string(), "tenant_id".to_string()],
            ref_schema: Some("sales".to_string()),
            ref_table: "customer".to_string(),
            ref_columns: vec!["id".to_string(), "tenant_id".to_string()],
            on_delete: on_delete.map(str::to_string),
            on_update: on_update.map(str::to_string),
            deferrable,
            initially_deferred: deferrable,
        }
    }

    fn column(name: &str, data_type: &str, pk: bool) -> ColumnDefinition {
        ColumnDefinition {
            name: name.to_string(),
            data_type: data_type.to_string(),
            is_nullable: !pk,
            default_value: None,
            is_primary_key: pk,
            is_unique: false,
        }
    }

    #[test]
    fn postgres_foreign_key_with_actions_and_deferrable() {
        let sql = constraint_clause(
            ConstraintDialect::Postgres,
            &fk(Some("cascade"), Some("set  null"), true),
        )
        .unwrap();
        assert_eq!(
            sql,
            "CONSTRAINT \"fk_order_customer\" FOREIGN KEY (\"customer_id\", \"tenant_id\") REFERENCES \"sales\".\"customer\" (\"id\", \"tenant_id\") ON DELETE CASCADE ON UPDATE SET NULL DEFERRABLE INITIALLY DEFERRED"
        );
    }

    #[test]
    fn mysql_foreign_key_uses_backticks_and_rejects_deferrable() {
        let sql = constraint_clause(ConstraintDialect::Mysql, &fk(Some("RESTRICT"), None, false))
            .unwrap();
        assert_eq!(
            sql,
            "CONSTRAINT `fk_order_customer` FOREIGN KEY (`customer_id`, `tenant_id`) REFERENCES `sales`.`customer` (`id`, `tenant_id`) ON DELETE RESTRICT"
        );
        assert!(
            constraint_clause(ConstraintDialect::Mysql, &fk(None, None, true))
                .unwrap_err()
                .contains("DEFERRABLE")
        );
        assert!(constraint_clause(
            ConstraintDialect::Mysql,
            &fk(Some("SET DEFAULT"), None, false)
        )
        .is_err());
    }

    #[test]
    fn mssql_uses_brackets_and_rejects_restrict() {
        let sql = constraint_clause(
            ConstraintDialect::Mssql,
            &fk(Some("SET DEFAULT"), Some("CASCADE"), false),
        )
        .unwrap();
        assert_eq!(
            sql,
            "CONSTRAINT [fk_order_customer] FOREIGN KEY ([customer_id], [tenant_id]) REFERENCES [sales].[customer] ([id], [tenant_id]) ON DELETE SET DEFAULT ON UPDATE CASCADE"
        );
        assert!(
            constraint_clause(ConstraintDialect::Mssql, &fk(Some("RESTRICT"), None, false))
                .is_err()
        );
    }

    #[test]
    fn oracle_has_no_on_update_and_supports_deferrable() {
        let sql = constraint_clause(ConstraintDialect::Oracle, &fk(Some("SET NULL"), None, true))
            .unwrap();
        assert!(sql.ends_with("ON DELETE SET NULL DEFERRABLE INITIALLY DEFERRED"));
        assert!(
            constraint_clause(ConstraintDialect::Oracle, &fk(None, Some("CASCADE"), false))
                .unwrap_err()
                .contains("ON UPDATE CASCADE")
        );
        let no_action = constraint_clause(
            ConstraintDialect::Oracle,
            &fk(Some("NO ACTION"), None, false),
        )
        .unwrap();
        assert!(no_action.ends_with("(\"id\", \"tenant_id\")"));
    }

    #[test]
    fn sqlite_references_are_unqualified() {
        let sql = constraint_clause(
            ConstraintDialect::Sqlite,
            &fk(Some("SET DEFAULT"), Some("RESTRICT"), true),
        )
        .unwrap();
        assert!(sql.contains("REFERENCES \"customer\" (\"id\", \"tenant_id\")"));
        assert!(
            sql.ends_with("ON DELETE SET DEFAULT ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED")
        );
    }

    #[test]
    fn duckdb_rejects_referential_actions() {
        assert!(constraint_clause(ConstraintDialect::Duckdb, &fk(None, None, false)).is_ok());
        assert!(
            constraint_clause(ConstraintDialect::Duckdb, &fk(Some("CASCADE"), None, false))
                .is_err()
        );
    }

    #[test]
    fn foreign_key_column_counts_must_match() {
        let constraint = TableConstraint::ForeignKey {
            name: None,
            columns: vec!["a".to_string(), "b".to_string()],
            ref_schema: None,
            ref_table: "t".to_string(),
            ref_columns: vec!["id".to_string()],
            on_delete: None,
            on_update: None,
            deferrable: false,
            initially_deferred: false,
        };
        assert!(constraint_clause(ConstraintDialect::Postgres, &constraint)
            .unwrap_err()
            .contains("2 lokale, aber 1 referenzierte"));
    }

    #[test]
    fn unique_and_check_clauses() {
        let unique = TableConstraint::Unique {
            name: None,
            columns: vec!["a".to_string(), "b".to_string()],
        };
        assert_eq!(
            constraint_clause(ConstraintDialect::Mssql, &unique).unwrap(),
            "UNIQUE ([a], [b])"
        );
        let check = TableConstraint::Check {
            name: Some("ck_price".to_string()),
            expression: " price > 0; ".to_string(),
        };
        assert_eq!(
            constraint_clause(ConstraintDialect::Mysql, &check).unwrap(),
            "CONSTRAINT `ck_price` CHECK (price > 0)"
        );
        let empty = TableConstraint::Check {
            name: None,
            expression: "  ".to_string(),
        };
        assert!(constraint_clause(ConstraintDialect::Postgres, &empty).is_err());
        let duplicate = TableConstraint::Unique {
            name: None,
            columns: vec!["a".to_string(), "a".to_string()],
        };
        assert!(constraint_clause(ConstraintDialect::Postgres, &duplicate).is_err());
    }

    #[test]
    fn table_clauses_validate_columns_and_single_primary_key() {
        let mut req = CreateTableRequest {
            schema: "public".to_string(),
            name: "orders".to_string(),
            columns: vec![column("id", "integer", true), column("code", "text", false)],
            constraints: vec![TableConstraint::Unique {
                name: None,
                columns: vec!["code".to_string()],
            }],
            ..Default::default()
        };
        assert_eq!(
            table_clauses(ConstraintDialect::Postgres, &req).unwrap(),
            vec!["UNIQUE (\"code\")".to_string()]
        );
        req.constraints.push(TableConstraint::PrimaryKey {
            name: None,
            columns: vec!["code".to_string()],
        });
        assert!(table_clauses(ConstraintDialect::Postgres, &req)
            .unwrap_err()
            .contains("nur einen Primärschlüssel"));
        req.constraints = vec![TableConstraint::Unique {
            name: None,
            columns: vec!["missing".to_string()],
        }];
        assert!(table_clauses(ConstraintDialect::Postgres, &req)
            .unwrap_err()
            .contains("missing"));
    }

    #[test]
    fn alter_add_and_drop_per_dialect() {
        let add = ConstraintChange::Add {
            constraint: TableConstraint::Check {
                name: Some("ck".to_string()),
                expression: "qty >= 0".to_string(),
            },
        };
        assert_eq!(
            change_sql(ConstraintDialect::Postgres, "public", "orders", &add).unwrap(),
            "ALTER TABLE \"public\".\"orders\" ADD CONSTRAINT \"ck\" CHECK (qty >= 0)"
        );
        assert_eq!(
            change_sql(ConstraintDialect::Oracle, "APP", "ORDERS", &add).unwrap(),
            "ALTER TABLE \"APP\".\"ORDERS\" ADD CONSTRAINT \"ck\" CHECK (qty >= 0)"
        );
        let drop = |constraint_type: &str| ConstraintChange::Drop {
            name: "c1".to_string(),
            constraint_type: constraint_type.to_string(),
        };
        assert_eq!(
            change_sql(
                ConstraintDialect::Mysql,
                "shop",
                "orders",
                &drop("FOREIGN KEY")
            )
            .unwrap(),
            "ALTER TABLE `shop`.`orders` DROP FOREIGN KEY `c1`"
        );
        assert_eq!(
            change_sql(ConstraintDialect::Mysql, "shop", "orders", &drop("UNIQUE")).unwrap(),
            "ALTER TABLE `shop`.`orders` DROP INDEX `c1`"
        );
        assert_eq!(
            change_sql(
                ConstraintDialect::Mysql,
                "shop",
                "orders",
                &drop("PRIMARY KEY")
            )
            .unwrap(),
            "ALTER TABLE `shop`.`orders` DROP PRIMARY KEY"
        );
        assert_eq!(
            change_sql(ConstraintDialect::Mysql, "shop", "orders", &drop("CHECK")).unwrap(),
            "ALTER TABLE `shop`.`orders` DROP CONSTRAINT `c1`"
        );
        assert_eq!(
            change_sql(
                ConstraintDialect::Mssql,
                "dbo",
                "orders",
                &drop("FOREIGN KEY")
            )
            .unwrap(),
            "ALTER TABLE [dbo].[orders] DROP CONSTRAINT [c1]"
        );
        assert!(
            change_sql(ConstraintDialect::Sqlite, "main", "orders", &add)
                .unwrap_err()
                .contains("neu aufbauen")
        );
        assert!(change_sql(ConstraintDialect::Duckdb, "main", "orders", &drop("CHECK")).is_err());
    }

    fn child_request(dialect_schema: &str) -> CreateTableRequest {
        CreateTableRequest {
            schema: dialect_schema.to_string(),
            name: "child".to_string(),
            columns: vec![
                column("id", "integer", true),
                column("parent_id", "integer", false),
                column("code", "varchar(10)", false),
                column("qty", "integer", false),
            ],
            primary_key_name: Some("pk_child".to_string()),
            constraints: vec![
                TableConstraint::ForeignKey {
                    name: Some("fk_child_parent".to_string()),
                    columns: vec!["parent_id".to_string()],
                    ref_schema: Some(dialect_schema.to_string()),
                    ref_table: "parent".to_string(),
                    ref_columns: vec!["id".to_string()],
                    on_delete: None,
                    on_update: None,
                    deferrable: false,
                    initially_deferred: false,
                },
                TableConstraint::Unique {
                    name: Some("uq_child".to_string()),
                    columns: vec!["parent_id".to_string(), "code".to_string()],
                },
                TableConstraint::Check {
                    name: Some("ck_qty".to_string()),
                    expression: "qty >= 0".to_string(),
                },
            ],
            ..Default::default()
        }
    }

    #[test]
    fn sqlite_executes_generated_create_table() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "PRAGMA foreign_keys = ON; CREATE TABLE parent (id integer PRIMARY KEY);",
        )
        .unwrap();
        let mut req = child_request("main");
        if let TableConstraint::ForeignKey { on_delete, .. } = &mut req.constraints[0] {
            *on_delete = Some("CASCADE".to_string());
        }
        let ddl = crate::db::create_table_ddl(
            &req,
            crate::db::sqlite::quote,
            true,
            Some(ConstraintDialect::Sqlite),
        )
        .unwrap();
        conn.execute_batch(&ddl).unwrap();
        conn.execute_batch(
            "INSERT INTO parent VALUES (1); INSERT INTO child VALUES (1, 1, 'a', 1);",
        )
        .unwrap();
        assert!(conn
            .execute_batch("INSERT INTO child VALUES (2, 9, 'b', 1);")
            .is_err());
        assert!(conn
            .execute_batch("INSERT INTO child VALUES (3, 1, 'a', 1);")
            .is_err());
        assert!(conn
            .execute_batch("INSERT INTO child VALUES (4, 1, 'c', -1);")
            .is_err());
        conn.execute_batch("DELETE FROM parent WHERE id = 1;")
            .unwrap();
        let remaining: i64 = conn
            .query_row("SELECT count(*) FROM child", [], |r| r.get(0))
            .unwrap();
        assert_eq!(remaining, 0);
    }

    #[cfg(feature = "duckdb")]
    #[test]
    fn duckdb_executes_generated_create_table() {
        let conn = duckdb::Connection::open_in_memory().unwrap();
        conn.execute_batch("CREATE TABLE parent (id integer PRIMARY KEY);")
            .unwrap();
        let ddl = crate::db::create_table_ddl(
            &child_request("main"),
            crate::db::duckdb::quote,
            true,
            Some(ConstraintDialect::Duckdb),
        )
        .unwrap();
        conn.execute_batch(&ddl).unwrap();
        conn.execute_batch(
            "INSERT INTO parent VALUES (1); INSERT INTO child VALUES (1, 1, 'a', 1);",
        )
        .unwrap();
        assert!(conn
            .execute_batch("INSERT INTO child VALUES (2, 9, 'b', 1);")
            .is_err());
        assert!(conn
            .execute_batch("INSERT INTO child VALUES (3, 1, 'a', 1);")
            .is_err());
        assert!(conn
            .execute_batch("INSERT INTO child VALUES (4, 1, 'c', -1);")
            .is_err());
    }

    #[test]
    fn change_deserializes_from_frontend_shape() {
        let change: ConstraintChange = serde_json::from_value(serde_json::json!({
            "action": "add",
            "constraint": {
                "kind": "foreign_key",
                "name": "fk",
                "columns": ["a"],
                "ref_schema": "public",
                "ref_table": "t",
                "ref_columns": ["id"],
                "on_delete": "CASCADE",
                "on_update": null,
                "deferrable": false,
                "initially_deferred": false
            }
        }))
        .unwrap();
        assert!(matches!(
            change,
            ConstraintChange::Add {
                constraint: TableConstraint::ForeignKey { .. }
            }
        ));
    }
}
