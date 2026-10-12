use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use oracle::Row;

use super::catalog::table_ddl;
use super::{binds, check_copy_schemas, quote, requalify, s, sql, OracleAdapter};
use crate::db::{DatabaseAdapter, SchemaDataCopy};

const SCHEMA_COPY_MAX_ROWS: i64 = 100_000;

pub(super) struct IncomingKey {
    add: String,
    validate: Option<String>,
}

pub(super) struct TableCopyPlan {
    sequences: Vec<(String, String)>,
    create: String,
    dependents: Vec<String>,
    foreign_keys: Vec<String>,
    incoming: Vec<IncomingKey>,
    skipped: Vec<String>,
}

impl TableCopyPlan {
    pub(super) fn script(&self) -> String {
        let notes = self.skipped.iter().map(|note| format!("-- {note}"));
        let statements = self
            .sequences
            .iter()
            .map(|(_, ddl)| ddl)
            .chain(std::iter::once(&self.create))
            .chain(&self.dependents)
            .chain(&self.foreign_keys)
            .chain(self.incoming.iter().map(|key| &key.add))
            .map(|statement| format!("{statement};"));
        notes.chain(statements).collect::<Vec<_>>().join("\n\n")
    }
}

fn identifier(token: &str) -> String {
    match token
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
    {
        Some(quoted) => quoted.replace("\"\"", "\""),
        None => token.to_uppercase(),
    }
}

pub(super) fn sequence_references(expression: &str, schema: &str) -> Vec<String> {
    let tokens: Vec<&str> = sql::tokens(expression)
        .into_iter()
        .map(|range| &expression[range])
        .collect();
    tokens
        .windows(5)
        .filter(|w| {
            w[1] == "."
                && w[3] == "."
                && identifier(w[0]) == schema
                && matches!(identifier(w[4]).as_str(), "NEXTVAL" | "CURRVAL")
        })
        .map(|w| identifier(w[2]))
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn with_novalidate(definition: &str) -> Option<String> {
    let trimmed = definition.trim_end();
    if trimmed.ends_with(" DISABLE") || trimmed.ends_with(" ENABLE NOVALIDATE") {
        None
    } else {
        Some(format!("{trimmed} ENABLE NOVALIDATE"))
    }
}

type References = HashMap<String, (String, String, Vec<String>)>;

impl OracleAdapter {
    async fn outgoing_references(&self, schema: &str, table: &str) -> Result<References, String> {
        let rows = self
            .rows_bound(
                "SELECT c.constraint_name, r.owner, r.table_name, rc.column_name FROM all_constraints c \
                 JOIN all_constraints r ON r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name \
                 JOIN all_cons_columns rc ON rc.owner = r.owner AND rc.constraint_name = r.constraint_name \
                 WHERE c.owner = :owner AND c.table_name = :tbl AND c.constraint_type = 'R' \
                 ORDER BY c.constraint_name, rc.position"
                    .to_string(),
                binds(&[("owner", schema), ("tbl", table)]),
            )
            .await?;
        let mut out = References::new();
        for r in &rows {
            out.entry(s(r, 0))
                .or_insert_with(|| (s(r, 1), s(r, 2), Vec::new()))
                .2
                .push(s(r, 3));
        }
        Ok(out)
    }

    async fn incoming_references(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<BTreeMap<String, Vec<(String, Vec<String>)>>, String> {
        let rows = self
            .rows_bound(
                "SELECT c.table_name, c.constraint_name, cc.column_name FROM all_constraints c \
                 JOIN all_constraints r ON r.owner = c.r_owner AND r.constraint_name = c.r_constraint_name \
                 JOIN all_cons_columns cc ON cc.owner = c.owner AND cc.constraint_name = c.constraint_name \
                 WHERE c.owner = :owner AND c.constraint_type = 'R' AND r.owner = :owner \
                 AND r.table_name = :tbl AND c.table_name <> :tbl AND c.table_name NOT LIKE 'BIN$%' \
                 ORDER BY c.table_name, c.constraint_name, cc.position"
                    .to_string(),
                binds(&[("owner", schema), ("tbl", table)]),
            )
            .await?;
        let mut out: BTreeMap<String, Vec<(String, Vec<String>)>> = BTreeMap::new();
        for r in &rows {
            let keys = out.entry(s(r, 0)).or_default();
            let constraint = s(r, 1);
            match keys.last_mut() {
                Some((name, columns)) if *name == constraint => columns.push(s(r, 2)),
                _ => keys.push((constraint, vec![s(r, 2)])),
            }
        }
        Ok(out)
    }

    pub(super) async fn table_copy_plan(
        &self,
        target: &dyn DatabaseAdapter,
        source_schema: &str,
        target_schema: &str,
        name: &str,
    ) -> Result<TableCopyPlan, String> {
        let table = Some(name);
        let (meta, (constraints, backing), columns, indexes, comments, outgoing, incoming) = tokio::try_join!(
            self.catalog_table_meta(source_schema, table),
            self.catalog_constraints(source_schema, table),
            self.catalog_columns(source_schema, table),
            self.catalog_indexes(source_schema, table),
            self.catalog_comments(source_schema, table),
            self.outgoing_references(source_schema, name),
            self.incoming_references(source_schema, name),
        )?;
        let meta = meta.first().ok_or_else(|| {
            format!(
                "Tabelle {source_schema}.{name} wurde nicht gefunden oder kann nicht kopiert werden (externe Tabellen und Materialized Views werden nicht unterstützt)."
            )
        })?;
        let moved = |ddl: &str| requalify(ddl, source_schema, target_schema);
        let prefix = format!("ALTER TABLE {}.{} ADD ", quote(source_schema), quote(name));
        let mut lines: Vec<String> = columns.iter().map(|column| column.ddl.clone()).collect();
        let mut foreign = Vec::new();
        for constraint in &constraints {
            if constraint
                .attributes
                .get("kind")
                .is_some_and(|kind| kind == "R")
            {
                foreign.push(constraint);
            } else if let Some(inline) = constraint.ddl.strip_prefix(&prefix) {
                lines.push(inline.to_string());
            }
        }
        let mut create = table_ddl(source_schema, meta, &lines);
        if s(meta, 3) == "YES" {
            let unreadable = |detail: String| {
                format!("Partitionierung von {source_schema}.{name} konnte nicht gelesen werden{detail}")
            };
            let clause = self
                .schema_partition_ddl_impl(source_schema, &[name.to_string()])
                .await
                .map_err(|e| unreadable(format!(": {e}")))?
                .remove(name)
                .ok_or_else(|| unreadable(".".to_string()))?;
            create.push('\n');
            create.push_str(&clause);
        }

        let referenced: Vec<String> = columns
            .iter()
            .filter_map(|column| column.attributes.get("default"))
            .flat_map(|default| sequence_references(default, source_schema))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect();
        let sequences = if referenced.is_empty() {
            Vec::new()
        } else {
            let existing: HashSet<String> = target
                .list_sequences(Some(target_schema))
                .await?
                .into_iter()
                .map(|sequence| sequence.name)
                .collect();
            let missing: Vec<String> = referenced
                .into_iter()
                .filter(|sequence| !existing.contains(sequence))
                .collect();
            self.catalog_sequences(source_schema, Some(&missing))
                .await?
                .iter()
                .map(|sequence| (sequence.name.clone(), moved(&sequence.ddl)))
                .collect()
        };

        let dependents = indexes
            .iter()
            .filter(|index| !backing.contains(&index.name))
            .chain(&comments)
            .map(|object| moved(&object.ddl))
            .collect();

        let mut foreign_keys = Vec::new();
        let mut skipped = Vec::new();
        for constraint in foreign {
            let Some((owner, parent, key)) = outgoing.get(&constraint.name) else {
                continue;
            };
            let available = owner != source_schema
                || parent == name
                || target
                    .list_constraints(target_schema, parent)
                    .await?
                    .iter()
                    .any(|candidate| {
                        matches!(candidate.constraint_type.as_str(), "PRIMARY KEY" | "UNIQUE")
                            && candidate.columns == *key
                    });
            if available {
                foreign_keys.push(moved(&constraint.ddl));
            } else {
                skipped.push(format!(
                    "Fremdschlüssel {} ausgelassen: {target_schema}.{parent} fehlt im Zielschema oder hat keinen passenden Primär-/Unique-Schlüssel.",
                    constraint.name
                ));
            }
        }

        let mut incoming_keys = Vec::new();
        for (child, keys) in incoming {
            let present: HashSet<String> = target
                .list_table_columns_detailed(target_schema, &child)
                .await?
                .into_iter()
                .map(|column| column.name)
                .collect();
            if present.is_empty() {
                continue;
            }
            let (child_constraints, _) = self
                .catalog_constraints(source_schema, Some(&child))
                .await?;
            for (constraint, key) in keys {
                let Some(object) = child_constraints.iter().find(|c| c.name == constraint) else {
                    continue;
                };
                if !key.iter().all(|column| present.contains(column)) {
                    continue;
                }
                let ddl = moved(&object.ddl);
                let novalidate = with_novalidate(&ddl);
                let validate = novalidate.is_some() && !object.attributes.contains_key("generated");
                incoming_keys.push(IncomingKey {
                    add: novalidate.unwrap_or(ddl),
                    validate: validate.then(|| {
                        format!(
                            "ALTER TABLE {}.{} MODIFY CONSTRAINT {} VALIDATE",
                            quote(target_schema),
                            quote(&child),
                            quote(&constraint)
                        )
                    }),
                });
            }
        }

        Ok(TableCopyPlan {
            sequences,
            create: moved(&create),
            dependents,
            foreign_keys,
            incoming: incoming_keys,
            skipped,
        })
    }

    pub(super) async fn execute_table_copy(
        &self,
        source_schema: &str,
        target_schema: &str,
        name: &str,
    ) -> Result<String, String> {
        let plan = self
            .table_copy_plan(self, source_schema, target_schema, name)
            .await?;
        let qualified = |object: &str| format!("{}.{}", quote(target_schema), quote(object));
        let steps = plan
            .sequences
            .iter()
            .map(|(sequence, ddl)| {
                (
                    ddl.clone(),
                    Some(format!("DROP SEQUENCE {}", qualified(sequence))),
                )
            })
            .chain(std::iter::once((
                plan.create.clone(),
                Some(format!(
                    "DROP TABLE {} CASCADE CONSTRAINTS PURGE",
                    qualified(name)
                )),
            )))
            .chain(
                plan.dependents
                    .iter()
                    .chain(&plan.foreign_keys)
                    .map(|statement| (statement.clone(), None)),
            );
        let mut undo: Vec<String> = Vec::new();
        let mut executed = Vec::new();
        for (statement, revert) in steps {
            if let Err(error) = self.exec(statement.clone()).await {
                if undo.is_empty() {
                    return Err(error);
                }
                for revert in undo.iter().rev() {
                    let _ = self.exec(revert.clone()).await;
                }
                return Err(format!(
                    "{error}\nDie bereits angelegten Objekte wurden wieder entfernt."
                ));
            }
            undo.extend(revert);
            executed.push(statement);
        }
        for key in &plan.incoming {
            if self.exec(key.add.clone()).await.is_ok() {
                executed.push(key.add.clone());
                if let Some(validate) = &key.validate {
                    if self.exec(validate.clone()).await.is_ok() {
                        executed.push(validate.clone());
                    }
                }
            }
        }
        Ok(executed
            .iter()
            .map(|statement| format!("{statement};"))
            .collect::<Vec<_>>()
            .join("\n\n"))
    }

    pub(super) async fn copy_table_data(
        &self,
        source_schema: &str,
        target_schema: &str,
        name: &str,
        limit: i64,
    ) -> Result<SchemaDataCopy, String> {
        check_copy_schemas(source_schema, target_schema)?;
        if limit <= 0 {
            return Err("Die Zeilenbegrenzung muss größer als 0 sein.".to_string());
        }
        let limit = limit.min(SCHEMA_COPY_MAX_ROWS);
        let columns_sql = "SELECT c.column_name, c.virtual_column, ic.generation_type, c.default_on_null \
             FROM all_tab_cols c \
             LEFT JOIN all_tab_identity_cols ic ON ic.owner = c.owner AND ic.table_name = c.table_name AND ic.column_name = c.column_name \
             WHERE c.owner = :owner AND c.table_name = :tbl AND c.user_generated = 'YES' \
             ORDER BY c.column_id NULLS LAST, c.internal_column_id";
        let (source_columns, target_columns, foreign_keys) = tokio::try_join!(
            self.rows_bound(
                columns_sql.to_string(),
                binds(&[("owner", source_schema), ("tbl", name)])
            ),
            self.rows_bound(
                columns_sql.to_string(),
                binds(&[("owner", target_schema), ("tbl", name)])
            ),
            self.rows_bound(
                "SELECT constraint_name, validated FROM all_constraints \
                 WHERE owner = :owner AND table_name = :tbl AND constraint_type = 'R' AND status = 'ENABLED' \
                 ORDER BY constraint_name"
                    .to_string(),
                binds(&[("owner", target_schema), ("tbl", name)])
            ),
        )?;
        let texts = |rows: Vec<Row>, width: usize| -> Vec<Vec<String>> {
            rows.iter()
                .map(|r| (0..width).map(|index| s(r, index)).collect())
                .collect()
        };
        let source_columns = texts(source_columns, 2);
        let target_columns = texts(target_columns, 4);
        let foreign_keys = texts(foreign_keys, 2);
        if source_columns.is_empty() {
            return Err(format!(
                "Tabelle {source_schema}.{name} hat keine Spalten oder existiert nicht."
            ));
        }
        if target_columns.is_empty() {
            return Err(format!(
                "Tabelle {target_schema}.{name} existiert nicht. Zuerst die Struktur kopieren."
            ));
        }
        let available: HashSet<&str> = source_columns
            .iter()
            .filter(|r| r[1] == "NO")
            .map(|r| r[0].as_str())
            .collect();
        let shared: Vec<&Vec<String>> = target_columns
            .iter()
            .filter(|r| r[1] == "NO" && available.contains(r[0].as_str()))
            .collect();
        if shared.is_empty() {
            return Err(format!(
                "Keine gemeinsamen Spalten zwischen {source_schema}.{name} und {target_schema}.{name}."
            ));
        }
        let table = format!("{}.{}", quote(target_schema), quote(name));
        let identities: Vec<(String, &str)> = shared
            .iter()
            .filter_map(|r| {
                let generation = match (r[2].as_str(), r[3] == "YES") {
                    ("", _) => return None,
                    ("ALWAYS", _) => "ALWAYS",
                    (_, true) => "BY DEFAULT ON NULL",
                    _ => "BY DEFAULT",
                };
                Some((quote(&r[0]), generation))
            })
            .collect();
        let constraints: Vec<(String, bool)> = foreign_keys
            .iter()
            .map(|r| (quote(&r[0]), r[1] == "VALIDATED"))
            .collect();

        let mut prepared = Ok(());
        for (constraint, _) in &constraints {
            prepared = prepared.and(
                self.exec(format!(
                    "ALTER TABLE {table} DISABLE CONSTRAINT {constraint}"
                ))
                .await
                .map(|_| ()),
            );
        }
        for (column, generation) in &identities {
            if *generation == "ALWAYS" {
                prepared = prepared.and(
                    self.exec(format!(
                        "ALTER TABLE {table} MODIFY ({column} GENERATED BY DEFAULT AS IDENTITY)"
                    ))
                    .await
                    .map(|_| ()),
                );
            }
        }
        let list = shared
            .iter()
            .map(|r| quote(&r[0]))
            .collect::<Vec<_>>()
            .join(", ");
        let inserted = match prepared {
            Ok(()) => {
                self.exec(format!(
                    "INSERT INTO {table} ({list}) SELECT {list} FROM {}.{} WHERE ROWNUM <= {limit}",
                    quote(source_schema),
                    quote(name)
                ))
                .await
            }
            Err(error) => Err(error),
        };

        let mut problems = Vec::new();
        for (column, generation) in &identities {
            let restart = matches!(inserted, Ok(rows) if rows > 0);
            if !restart && *generation != "ALWAYS" {
                continue;
            }
            if let Err(error) = self
                .exec(format!(
                    "ALTER TABLE {table} MODIFY ({column} GENERATED {generation} AS IDENTITY{})",
                    if restart {
                        " (START WITH LIMIT VALUE)"
                    } else {
                        ""
                    }
                ))
                .await
            {
                problems.push(error);
            }
        }
        let mut unvalidated = Vec::new();
        for ((constraint, validated), row) in constraints.iter().zip(&foreign_keys) {
            let original = &row[0];
            if *validated
                && self
                    .exec(format!(
                        "ALTER TABLE {table} ENABLE VALIDATE CONSTRAINT {constraint}"
                    ))
                    .await
                    .is_ok()
            {
                continue;
            }
            match self
                .exec(format!(
                    "ALTER TABLE {table} ENABLE NOVALIDATE CONSTRAINT {constraint}"
                ))
                .await
            {
                Ok(_) if *validated => unvalidated.push(original.clone()),
                Ok(_) => {}
                Err(error) => problems.push(error),
            }
        }
        let rows = inserted?;
        if !problems.is_empty() {
            return Err(problems.join("\n"));
        }
        Ok(SchemaDataCopy { rows, unvalidated })
    }
}

#[cfg(test)]
mod tests {
    use super::{requalify, sequence_references, with_novalidate, OracleAdapter};
    use crate::db::DatabaseAdapter;
    use std::collections::BTreeSet;

    const SRC: &str = "L8DB_CP_SRC";
    const EDIT: &str = "L8DB_CP_EDIT";
    const EXEC: &str = "L8DB_CP_EXEC";
    const TABLES: [&str; 6] = ["AUFTRAG", "KUNDE", "Baum", "PUFFER", "SCHLUESSEL", "LOG"];
    const CODE: [(&str, &str); 4] = [
        ("routine", "F_ANZAHL"),
        ("routine", "P_ADD"),
        ("package", "PKG"),
        ("view", "V_KUNDE"),
    ];
    const SETUP: &[&str] = &[
        "CREATE SEQUENCE L8DB_CP_SRC.AUFTRAG_SEQ START WITH 100 INCREMENT BY 5",
        "CREATE TABLE L8DB_CP_SRC.KUNDE (\
           ID NUMBER GENERATED BY DEFAULT ON NULL AS IDENTITY (START WITH 1000 INCREMENT BY 10), \
           NAME VARCHAR2(40 CHAR) NOT NULL, KUERZEL CHAR(3 BYTE), BETRAG NUMBER(10,2) DEFAULT 0, \
           ZAEHLER INTEGER, HASH RAW(16), ANGELEGT DATE DEFAULT SYSDATE NOT NULL, \
           ZEIT TIMESTAMP(3) WITH TIME ZONE, FAKTOR FLOAT(63), NOTIZ CLOB, GEHEIM VARCHAR2(10) INVISIBLE, \
           BRUTTO NUMBER GENERATED ALWAYS AS (BETRAG * 1.19) VIRTUAL, \
           CONSTRAINT KUNDE_PK PRIMARY KEY (ID), \
           CONSTRAINT KUNDE_NAME_UK UNIQUE (NAME) DEFERRABLE INITIALLY DEFERRED, \
           CONSTRAINT KUNDE_BETRAG_CK CHECK (BETRAG >= 0))",
        "COMMENT ON TABLE L8DB_CP_SRC.KUNDE IS 'Kunden''s Tabelle'",
        "COMMENT ON COLUMN L8DB_CP_SRC.KUNDE.NAME IS 'Name des Kunden'",
        "CREATE INDEX L8DB_CP_SRC.KUNDE_SUCHE_IX ON L8DB_CP_SRC.KUNDE (KUERZEL DESC, UPPER(NAME))",
        "CREATE TABLE L8DB_CP_SRC.AUFTRAG (ID NUMBER DEFAULT l8db_cp_src.auftrag_seq.nextval, \
           KUNDE_ID NUMBER NOT NULL, POS NUMBER(5) NOT NULL, \
           CONSTRAINT AUFTRAG_PK PRIMARY KEY (ID, POS), \
           CONSTRAINT AUFTRAG_KUNDE_FK FOREIGN KEY (KUNDE_ID) REFERENCES L8DB_CP_SRC.KUNDE (ID) ON DELETE CASCADE)",
        "CREATE TABLE L8DB_CP_SRC.\"Baum\" (\"Id\" NUMBER PRIMARY KEY, \"Eltern\" NUMBER REFERENCES L8DB_CP_SRC.\"Baum\" (\"Id\"))",
        "CREATE GLOBAL TEMPORARY TABLE L8DB_CP_SRC.PUFFER (ID NUMBER) ON COMMIT DELETE ROWS",
        "CREATE TABLE L8DB_CP_SRC.SCHLUESSEL (K VARCHAR2(10) PRIMARY KEY, V NUMBER) ORGANIZATION INDEX",
        "CREATE TABLE L8DB_CP_SRC.LOG (ID NUMBER, TAG DATE NOT NULL) PARTITION BY RANGE (TAG) \
           INTERVAL (NUMTOYMINTERVAL(1, 'MONTH')) (PARTITION P0 VALUES LESS THAN (DATE '2026-01-01'))",
        "CREATE FUNCTION L8DB_CP_SRC.F_ANZAHL(p_id NUMBER) RETURN NUMBER AS\n  v NUMBER;\nBEGIN\n  SELECT COUNT(*) INTO v FROM l8db_cp_src.auftrag WHERE kunde_id = p_id;\n  RETURN v;\nEND;",
        "CREATE PROCEDURE l8db_cp_src.p_add(p_name VARCHAR2) IS\nBEGIN\n  INSERT INTO L8DB_CP_SRC.KUNDE (NAME) VALUES (p_name);\nEND p_add;",
        "CREATE PACKAGE L8DB_CP_SRC.PKG AS\n  FUNCTION summe RETURN NUMBER;\nEND PKG;",
        "CREATE PACKAGE BODY L8DB_CP_SRC.PKG AS\n  FUNCTION summe RETURN NUMBER IS\n    v NUMBER;\n  BEGIN\n    SELECT SUM(betrag) INTO v FROM \"L8DB_CP_SRC\".kunde;\n    RETURN v + l8db_cp_src.f_anzahl(1);\n  END;\nEND PKG;",
        "CREATE VIEW L8DB_CP_SRC.V_KUNDE AS SELECT k.id, k.name, l8db_cp_src.f_anzahl(k.id) AS anzahl FROM l8db_cp_src.kunde k WITH READ ONLY",
    ];

    async fn drop_users(a: &OracleAdapter) {
        for user in [SRC, EDIT, EXEC, "L8DB_CP_OTHER"] {
            let _ = a.execute_query(&format!("DROP USER {user} CASCADE")).await;
        }
    }

    async fn value(a: &OracleAdapter, sql: &str) -> String {
        let result = a
            .execute_query(sql)
            .await
            .unwrap_or_else(|e| panic!("{sql}: {e}"));
        let row = &result.rows[0];
        let value = &row[&result.columns[0]];
        value
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| value.to_string())
    }

    async fn structure(a: &OracleAdapter, schema: &str) -> BTreeSet<String> {
        let types: Vec<String> = [
            "table",
            "constraint",
            "index",
            "comment",
            "sequence",
            "view",
            "function",
            "procedure",
            "package",
            "package_body",
        ]
        .map(String::from)
        .to_vec();
        a.schema_catalog(schema, &types)
            .await
            .unwrap()
            .into_iter()
            .map(|object| {
                let ddl = requalify(&object.ddl, schema, "SCHEMA");
                format!(
                    "{} {} {}",
                    object.object_type,
                    object.parent.unwrap_or_default(),
                    ddl.split_whitespace().collect::<Vec<_>>().join(" ")
                )
            })
            .collect()
    }

    #[tokio::test]
    #[ignore]
    async fn live_copies_every_object_kind_into_another_schema() {
        let Ok(url) = std::env::var("L8DB_SMOKE_ORACLE_URL") else {
            return;
        };
        let a = OracleAdapter::new(
            &url,
            crate::db::pool::create_pool_state(),
            "schema-copy".into(),
        )
        .unwrap();
        drop_users(&a).await;
        for user in [SRC, EDIT, EXEC] {
            if let Err(e) = a
                .execute_query(&format!(
                    "CREATE USER {user} IDENTIFIED BY \"Pw_12345\" QUOTA UNLIMITED ON USERS"
                ))
                .await
            {
                assert!(e.contains("ORA-01031"), "{e}");
                eprintln!("Schema-Kopie: übersprungen ({e})");
                return;
            }
        }
        for statement in SETUP {
            a.execute_query(statement)
                .await
                .unwrap_or_else(|e| panic!("{statement}: {e}"));
        }

        assert!(a
            .preview_schema_object_copy(SRC, SRC, "table", "KUNDE")
            .await
            .unwrap_err()
            .contains("identisch"));

        let child = a
            .preview_schema_object_copy(SRC, EDIT, "table", "AUFTRAG")
            .await
            .unwrap();
        assert!(
            child.contains("-- Fremdschlüssel AUFTRAG_KUNDE_FK ausgelassen"),
            "{child}"
        );
        assert!(
            child.contains(
                "CREATE SEQUENCE \"L8DB_CP_EDIT\".\"AUFTRAG_SEQ\" START WITH 100 INCREMENT BY 5"
            ),
            "{child}"
        );
        assert!(
            child.contains("DEFAULT \"L8DB_CP_EDIT\".auftrag_seq.nextval"),
            "{child}"
        );
        assert!(!child.to_uppercase().contains("L8DB_CP_SRC"), "{child}");

        for name in TABLES {
            let script = a
                .preview_schema_object_copy(SRC, EDIT, "table", name)
                .await
                .unwrap();
            if name == "KUNDE" {
                assert!(script.contains("ALTER TABLE \"L8DB_CP_EDIT\".\"AUFTRAG\" ADD CONSTRAINT \"AUFTRAG_KUNDE_FK\" FOREIGN KEY (\"KUNDE_ID\") REFERENCES \"L8DB_CP_EDIT\".\"KUNDE\" (\"ID\") ON DELETE CASCADE ENABLE NOVALIDATE;"), "{script}");
            }
            let results = a.execute_script(&script).await.unwrap();
            assert!(
                results.iter().all(|r| r.success),
                "{name}:\n{script}\n{results:#?}"
            );
        }
        for (kind, name) in CODE {
            let script = a
                .preview_schema_object_copy(SRC, EDIT, kind, name)
                .await
                .unwrap();
            assert!(!script.to_uppercase().contains("L8DB_CP_SRC"), "{script}");
            let results = a.execute_script(&script).await.unwrap();
            assert!(
                results.iter().all(|r| r.success),
                "{name}:\n{script}\n{results:#?}"
            );
        }

        for name in TABLES {
            a.execute_schema_object_copy(SRC, EXEC, "table", name)
                .await
                .unwrap_or_else(|e| panic!("{name}: {e}"));
        }
        for (kind, name) in CODE {
            a.execute_schema_object_copy(SRC, EXEC, kind, name)
                .await
                .unwrap_or_else(|e| panic!("{name}: {e}"));
        }
        assert!(a
            .execute_schema_object_copy(SRC, EXEC, "table", "KUNDE")
            .await
            .unwrap_err()
            .contains("Namenskonflikt"));

        let source = structure(&a, SRC).await;
        assert_eq!(structure(&a, EXEC).await, source);
        let edited: BTreeSet<String> = structure(&a, EDIT)
            .await
            .into_iter()
            .map(|line| line.replace(" ENABLE NOVALIDATE", ""))
            .collect();
        assert_eq!(edited, source);

        for target in [EDIT, EXEC] {
            let invalid = value(&a, &format!("SELECT COUNT(*) FROM all_objects WHERE owner = '{target}' AND status <> 'VALID'")).await;
            assert_eq!(invalid, "0", "{target}");
            let foreign = value(&a, &format!("SELECT COUNT(*) FROM all_dependencies WHERE owner = '{target}' AND referenced_owner = '{SRC}'")).await;
            assert_eq!(foreign, "0", "{target}");
            let read_only = value(&a, &format!("SELECT read_only FROM all_views WHERE owner = '{target}' AND view_name = 'V_KUNDE'")).await;
            assert_eq!(read_only, "Y", "{target}");
            let partitioned = value(&a, &format!("SELECT partitioning_type || ' ' || interval FROM all_part_tables WHERE owner = '{target}' AND table_name = 'LOG'")).await;
            assert_eq!(partitioned, "RANGE NUMTOYMINTERVAL(1, 'MONTH')", "{target}");
        }
        a.execute_query("INSERT INTO L8DB_CP_EDIT.KUNDE (NAME) VALUES ('a')")
            .await
            .unwrap();
        assert_eq!(
            value(&a, "SELECT MAX(ID) FROM L8DB_CP_EDIT.KUNDE").await,
            "1000"
        );
        a.execute_query("INSERT INTO L8DB_CP_EDIT.AUFTRAG (KUNDE_ID, POS) VALUES (1000, 1)")
            .await
            .unwrap();
        assert_eq!(
            value(&a, "SELECT MAX(ID) FROM L8DB_CP_EDIT.AUFTRAG").await,
            "100"
        );

        for statement in [
            "INSERT INTO L8DB_CP_SRC.KUNDE (NAME, BETRAG) VALUES ('x', 1)",
            "INSERT INTO L8DB_CP_SRC.KUNDE (NAME, BETRAG) VALUES ('y', 2)",
            "INSERT INTO L8DB_CP_SRC.KUNDE (NAME, BETRAG) VALUES ('z', 3)",
            "INSERT INTO L8DB_CP_SRC.AUFTRAG (KUNDE_ID, POS) VALUES (1000, 1)",
            "INSERT INTO L8DB_CP_SRC.AUFTRAG (KUNDE_ID, POS) VALUES (1010, 1)",
            "INSERT INTO L8DB_CP_SRC.\"Baum\" VALUES (1, NULL)",
            "INSERT INTO L8DB_CP_SRC.\"Baum\" VALUES (2, 1)",
        ] {
            a.execute_query(statement)
                .await
                .unwrap_or_else(|e| panic!("{statement}: {e}"));
        }
        let child = a
            .copy_schema_table_data(SRC, EXEC, "AUFTRAG", 1000)
            .await
            .unwrap();
        assert_eq!(
            (child.rows, child.unvalidated),
            (2, vec!["AUFTRAG_KUNDE_FK".to_string()])
        );
        let parent = a
            .copy_schema_table_data(SRC, EXEC, "KUNDE", 2)
            .await
            .unwrap();
        assert_eq!((parent.rows, parent.unvalidated.len()), (2, 0));
        let tree = a
            .copy_schema_table_data(SRC, EXEC, "Baum", 1000)
            .await
            .unwrap();
        assert_eq!((tree.rows, tree.unvalidated.len()), (2, 0));
        a.execute_query("INSERT INTO L8DB_CP_EXEC.KUNDE (NAME) VALUES ('neu')")
            .await
            .unwrap();
        assert_eq!(
            value(
                &a,
                "SELECT COUNT(*) FROM L8DB_CP_EXEC.KUNDE WHERE ID >= (SELECT ID FROM L8DB_CP_EXEC.KUNDE WHERE NAME = 'neu')"
            )
            .await,
            "1"
        );
        let foreign_status = "SELECT status || ' ' || validated FROM all_constraints WHERE owner = 'L8DB_CP_EXEC' AND constraint_name = 'AUFTRAG_KUNDE_FK'";
        assert_eq!(value(&a, foreign_status).await, "ENABLED NOT VALIDATED");
        let disabled = "SELECT COUNT(*) FROM all_constraints WHERE owner = 'L8DB_CP_EXEC' AND constraint_type = 'R' AND status <> 'ENABLED'";
        assert_eq!(value(&a, disabled).await, "0");
        let duplicate = a
            .copy_schema_table_data(SRC, EXEC, "KUNDE", 10)
            .await
            .unwrap_err();
        assert!(duplicate.contains("ORA-00001"), "{duplicate}");
        assert_eq!(value(&a, disabled).await, "0");

        a.execute_query(
            "CREATE USER L8DB_CP_OTHER IDENTIFIED BY \"Pw_12345\" QUOTA UNLIMITED ON USERS",
        )
        .await
        .unwrap();
        a.execute_query("CREATE SEQUENCE L8DB_CP_OTHER.AUFTRAG_SEQ")
            .await
            .unwrap();
        let other = OracleAdapter::new(
            &url,
            crate::db::pool::create_pool_state(),
            "schema-copy-target".into(),
        )
        .unwrap();
        let into = a
            .preview_schema_object_copy_into(&other, SRC, "L8DB_CP_OTHER", "table", "AUFTRAG")
            .await
            .unwrap();
        assert!(!into.contains("CREATE SEQUENCE"), "{into}");

        drop_users(&a).await;
    }

    #[test]
    fn finds_sequences_of_the_source_schema() {
        assert_eq!(
            sequence_references("\"HR\".\"EMP_SEQ\".\"NEXTVAL\"", "HR"),
            vec!["EMP_SEQ"]
        );
        assert_eq!(
            sequence_references("hr.emp_seq.nextval + hr.\"Mixed\".currval", "HR"),
            vec!["EMP_SEQ", "Mixed"]
        );
        assert!(sequence_references("other.emp_seq.nextval", "HR").is_empty());
        assert!(sequence_references("'HR.EMP_SEQ.NEXTVAL'", "HR").is_empty());
        assert!(sequence_references("SYSDATE", "HR").is_empty());
    }

    #[test]
    fn marks_incoming_keys_novalidate_once() {
        assert_eq!(
            with_novalidate("ALTER TABLE \"B\".\"C\" ADD FOREIGN KEY (\"P\") REFERENCES \"B\".\"P\" (\"ID\")").as_deref(),
            Some("ALTER TABLE \"B\".\"C\" ADD FOREIGN KEY (\"P\") REFERENCES \"B\".\"P\" (\"ID\") ENABLE NOVALIDATE")
        );
        assert_eq!(with_novalidate("X DISABLE"), None);
        assert_eq!(with_novalidate("X ENABLE NOVALIDATE"), None);
    }
}
