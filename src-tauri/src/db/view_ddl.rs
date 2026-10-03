fn skip_trivia(sql: &str, mut i: usize) -> usize {
    let bytes = sql.as_bytes();
    loop {
        while i < bytes.len() && bytes[i].is_ascii_whitespace() {
            i += 1;
        }
        if sql[i..].starts_with("--") {
            i = sql[i..].find('\n').map_or(sql.len(), |end| i + end + 1);
        } else if sql[i..].starts_with("/*") {
            i = sql[i + 2..]
                .find("*/")
                .map_or(sql.len(), |end| i + 2 + end + 2);
        } else {
            return i;
        }
    }
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b'_' | b'$' | b'#' | b'@') || b >= 0x80
}

fn keyword(sql: &str, i: usize, word: &str) -> Option<usize> {
    let end = i + word.len();
    let matches = sql
        .get(i..end)
        .is_some_and(|w| w.eq_ignore_ascii_case(word))
        && sql.as_bytes().get(end).is_none_or(|b| !is_word_byte(*b));
    matches.then(|| skip_trivia(sql, end))
}

fn identifier(sql: &str, i: usize) -> Option<usize> {
    let bytes = sql.as_bytes();
    let close = match bytes.get(i)? {
        b'"' => b'"',
        b'`' => b'`',
        b'[' => b']',
        b if is_word_byte(*b) => {
            let mut end = i;
            while end < bytes.len() && is_word_byte(bytes[end]) {
                end += 1;
            }
            return Some(end);
        }
        _ => return None,
    };
    let mut end = i + 1;
    while end < bytes.len() {
        if bytes[end] == close {
            if bytes.get(end + 1) == Some(&close) {
                end += 2;
                continue;
            }
            return Some(end + 1);
        }
        end += 1;
    }
    None
}

pub(crate) fn view_ddl_tail(sql: &str) -> Option<&str> {
    let mut i = keyword(sql, skip_trivia(sql, 0), "CREATE")?;
    if let Some(next) = keyword(sql, i, "OR") {
        i = keyword(sql, next, "REPLACE").or_else(|| keyword(sql, next, "ALTER"))?;
    }
    if let Some(next) = keyword(sql, i, "TEMPORARY").or_else(|| keyword(sql, i, "TEMP")) {
        i = next;
    }
    i = keyword(sql, i, "VIEW")?;
    if let Some(next) = keyword(sql, i, "IF") {
        i = keyword(sql, keyword(sql, next, "NOT")?, "EXISTS")?;
    }
    let mut end = identifier(sql, i)?;
    loop {
        let dot = skip_trivia(sql, end);
        if sql.as_bytes().get(dot) != Some(&b'.') {
            break;
        }
        end = identifier(sql, skip_trivia(sql, dot + 1))?;
    }
    let tail = sql[end..].trim_start();
    (!tail.is_empty()).then_some(tail)
}

pub(crate) fn view_ddl_rest(body: &str) -> String {
    match view_ddl_tail(body) {
        Some(tail) => tail.to_string(),
        None => format!("AS {body}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::pool::create_pool_state;
    use crate::db::DatabaseAdapter;

    #[test]
    fn full_view_statements_keep_everything_after_the_name() {
        let cases = [
            ("CREATE VIEW v AS SELECT 1", "AS SELECT 1"),
            ("create view \"main\".\"v\" as select 1", "as select 1"),
            (
                "CREATE VIEW v(a, b) AS SELECT x, y FROM t",
                "(a, b) AS SELECT x, y FROM t",
            ),
            (
                "CREATE TEMP VIEW IF NOT EXISTS v AS SELECT 1",
                "AS SELECT 1",
            ),
            (
                "CREATE OR REPLACE VIEW \"s\".\"we\"\"ird\" AS SELECT 1;",
                "AS SELECT 1;",
            ),
            (
                "-- header\n/* note */\r\nCREATE VIEW [dbo].[v x] WITH SCHEMABINDING AS SELECT a FROM dbo.t",
                "WITH SCHEMABINDING AS SELECT a FROM dbo.t",
            ),
            ("CREATE OR ALTER VIEW dbo . [v]]x]AS SELECT 1", "AS SELECT 1"),
            ("CREATE VIEW `db`.`v` AS SELECT 1", "AS SELECT 1"),
            (
                "CREATE VIEW db.v (`a` UInt8) AS SELECT 1 AS a",
                "(`a` UInt8) AS SELECT 1 AS a",
            ),
            ("CREATE VIEW sales.Ümsatz AS SELECT 1", "AS SELECT 1"),
        ];
        for (sql, tail) in cases {
            assert_eq!(view_ddl_tail(sql), Some(tail), "{sql}");
        }
    }

    #[test]
    fn select_bodies_and_other_statements_are_not_view_ddl() {
        for sql in [
            "SELECT 1",
            "WITH x AS (SELECT 1) SELECT * FROM x",
            "  select created_view from t",
            "CREATE MATERIALIZED VIEW mv AS SELECT 1",
            "CREATE TABLE v AS SELECT 1",
            "CREATE VIEWS v AS SELECT 1",
            "CREATE VIEW",
            "CREATE VIEW \"unterminated AS SELECT 1",
            "-- only a comment",
        ] {
            assert_eq!(view_ddl_tail(sql), None, "{sql}");
        }
        assert_eq!(view_ddl_rest("SELECT 1"), "AS SELECT 1");
        assert_eq!(
            view_ddl_rest("CREATE VIEW v (a) AS SELECT 1"),
            "(a) AS SELECT 1"
        );
    }

    const SETUP: [&str; 3] = [
        "CREATE TABLE t (x INTEGER, y INTEGER)",
        "INSERT INTO t VALUES (1, 2)",
        "CREATE VIEW v (a, b) AS SELECT x, y FROM t",
    ];

    async fn roundtrip(adapter: &dyn DatabaseAdapter, schema: &str) {
        let original = adapter.get_view_definition(schema, "v").await.unwrap();
        let edited = original.replace("SELECT x, y FROM t", "SELECT x + 10, y FROM t");
        assert_ne!(original, edited);
        adapter
            .update_view_definition(schema, "v", &edited, true)
            .await
            .unwrap();
        assert_eq!(
            adapter.get_view_definition(schema, "v").await.unwrap(),
            original
        );
        adapter
            .update_view_definition(schema, "v", &edited, false)
            .await
            .unwrap();
        let result = adapter.execute_query("SELECT a, b FROM v").await.unwrap();
        assert_eq!(result.columns, ["a", "b"]);
        assert_eq!(result.rows[0]["a"], 11);
        assert_eq!(result.rows[0]["b"], 2);
        let broken = edited.replace("FROM t", "FROM t WHERE");
        assert!(adapter
            .update_view_definition(schema, "v", &broken, false)
            .await
            .is_err());
        let after = adapter.execute_query("SELECT a FROM v").await.unwrap();
        assert_eq!(after.rows[0]["a"], 11);
        adapter
            .update_view_definition(schema, "v", "SELECT y, x FROM t", false)
            .await
            .unwrap();
        let plain = adapter.execute_query("SELECT y FROM v").await.unwrap();
        assert_eq!(plain.rows[0]["y"], 2);
    }

    #[tokio::test]
    async fn sqlite_saves_the_definition_it_shows() {
        let adapter = crate::db::sqlite::SqliteAdapter::new(
            ":memory:",
            create_pool_state(),
            "view-ddl-sqlite".into(),
        )
        .unwrap();
        for sql in SETUP {
            adapter.execute_query(sql).await.unwrap();
        }
        roundtrip(&adapter, "main").await;
    }

    #[cfg(feature = "duckdb")]
    #[tokio::test]
    async fn duckdb_saves_the_definition_it_shows() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("views.duckdb");
        let adapter = crate::db::duckdb::DuckdbAdapter::new(
            &format!("duckdb:{}?mode=rwc", path.display()),
            create_pool_state(),
            "view-ddl-duckdb".into(),
        )
        .unwrap();
        for sql in SETUP {
            adapter.execute_query(sql).await.unwrap();
        }
        roundtrip(&adapter, "main").await;
    }

    #[tokio::test]
    #[ignore]
    async fn live_mssql_saves_the_definition_it_shows() {
        let Ok(url) = std::env::var("L8DB_SMOKE_MSSQL_URL") else {
            return;
        };
        let adapter = crate::db::mssql::MssqlAdapter::new(
            &url,
            Some("master"),
            create_pool_state(),
            "view-ddl-mssql".into(),
        )
        .unwrap();
        for sql in [
            "IF OBJECT_ID('dbo.w2') IS NOT NULL DROP VIEW dbo.w2",
            "IF OBJECT_ID('dbo.w') IS NOT NULL DROP VIEW dbo.w",
            "IF OBJECT_ID('dbo.v') IS NOT NULL DROP VIEW dbo.v",
            "IF OBJECT_ID('dbo.t') IS NOT NULL DROP TABLE dbo.t",
        ]
        .into_iter()
        .chain(SETUP)
        {
            adapter.execute_query(sql).await.unwrap();
        }
        roundtrip(&adapter, "dbo").await;
        for sql in [
            "CREATE VIEW dbo.w WITH SCHEMABINDING AS SELECT x FROM dbo.t",
            "EXEC sp_rename 'dbo.w', 'w2'",
        ] {
            adapter.execute_query(sql).await.unwrap();
        }
        let stale = adapter.get_view_definition("dbo", "w2").await.unwrap();
        assert!(stale.contains("dbo.w "));
        adapter
            .update_view_definition(
                "dbo",
                "w2",
                &stale.replace("SELECT x", "SELECT x, y"),
                false,
            )
            .await
            .unwrap();
        let renamed = adapter.execute_query("SELECT y FROM dbo.w2").await.unwrap();
        assert_eq!(renamed.rows[0]["y"], 2);
        let schemabound = adapter
            .execute_query("SELECT OBJECTPROPERTY(OBJECT_ID('dbo.w2'), 'IsSchemaBound') AS b")
            .await
            .unwrap();
        assert_eq!(schemabound.rows[0]["b"], 1);
        assert!(adapter
            .execute_query("SELECT 1 AS n FROM sys.views WHERE name = 'w'")
            .await
            .unwrap()
            .rows
            .is_empty());
        for sql in ["DROP VIEW dbo.w2", "DROP VIEW dbo.v", "DROP TABLE dbo.t"] {
            adapter.execute_query(sql).await.unwrap();
        }
    }
}
