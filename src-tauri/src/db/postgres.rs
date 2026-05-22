use std::str::FromStr;
use std::time::Duration;

use async_trait::async_trait;
use bb8::PooledConnection;
use bb8_postgres::PostgresConnectionManager;
use tokio::time::timeout;
use tokio_postgres::{Config, NoTls, SimpleQueryMessage};

use super::pool::PoolState;
use super::{map_pg_err, quote_ident, AlterRoleOptions, ColumnInfo, ConnectionConfig, CreateRoleOptions, DatabaseAdapter, ERColumn, ERSchema, ERTable, ExtensionInfo, ForeignKeyInfo, FunctionInfo, PrivilegeChange, QueryResult, RoleInfo, RolePrivileges, SchemaPrivileges, TableData, TableInfo, TablePrivileges, TriggerInfo};

const QUERY_TIMEOUT: Duration = Duration::from_secs(30);

pub struct PostgresAdapter {
    config: Config,
    pool_state: PoolState,
    pool_key: String,
}

impl PostgresAdapter {
    pub fn from_config(config: ConnectionConfig, pool_state: PoolState) -> Self {
        let mut pg = Config::new();
        pg.host(&config.host)
            .port(config.port)
            .user(&config.user)
            .password(&config.password)
            .dbname(&config.database)
            .connect_timeout(Duration::from_secs(10));
        let pool_key = format!(
            "{}:{}@{}:{}/{}",
            config.user, config.password, config.host, config.port, config.database
        );
        Self {
            config: pg,
            pool_state,
            pool_key,
        }
    }

    pub fn from_connection_string(
        connection_string: &str,
        database: Option<&str>,
        pool_state: PoolState,
    ) -> Result<Self, String> {
        let mut config =
            Config::from_str(connection_string).map_err(|e| format!("Ungültiger Connection String: {e}"))?;
        if let Some(database) = database {
            if !database.is_empty() {
                config.dbname(database);
            }
        }
        config.connect_timeout(Duration::from_secs(10));
        let pool_key = match database {
            Some(db) if !db.is_empty() => format!("{connection_string}##{db}"),
            _ => connection_string.to_string(),
        };
        Ok(Self {
            config,
            pool_state,
            pool_key,
        })
    }

    async fn get_conn(
        &self,
    ) -> Result<PooledConnection<'static, PostgresConnectionManager<NoTls>>, String> {
        let pool = self
            .pool_state
            .get_pool(&self.pool_key, self.config.clone())
            .await?;
        pool.get_owned()
            .await
            .map_err(|e| format!("Verbindung fehlgeschlagen: {e}"))
    }

    async fn timed<F, T>(&self, future: F) -> Result<T, String>
    where
        F: std::future::Future<Output = Result<T, String>>,
    {
        timeout(QUERY_TIMEOUT, future)
            .await
            .map_err(|_| "Query-Timeout: Die Abfrage hat länger als 30 Sekunden gedauert".to_string())?
    }
}

#[async_trait]
impl DatabaseAdapter for PostgresAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            conn.simple_query("SELECT 1")
                .await
                .map(|_| ())
                .map_err(map_pg_err)
        })
        .await
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            conn.query(
                "SELECT datname FROM pg_database \
                 WHERE datistemplate = false AND datallowconn = true \
                 ORDER BY datname",
                &[],
            )
            .await
            .map_err(map_pg_err)
            .map(|rows| rows.into_iter().map(|row| row.get(0)).collect())
        })
        .await
    }

    async fn list_schemas(&self) -> Result<Vec<String>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            conn.query(
                "SELECT schema_name FROM information_schema.schemata \
                 WHERE schema_name <> 'information_schema' \
                   AND schema_name NOT LIKE 'pg_%' \
                 ORDER BY schema_name",
                &[],
            )
            .await
            .map_err(map_pg_err)
            .map(|rows| rows.into_iter().map(|row| row.get(0)).collect())
        })
        .await
    }

    async fn list_tables(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let query = match schema {
                Some(schema) => {
                    conn.query(
                        "SELECT table_schema, table_name \
                         FROM information_schema.tables \
                         WHERE table_type = 'BASE TABLE' AND table_schema = $1 \
                         ORDER BY table_name",
                        &[&schema],
                    )
                    .await
                }
                None => {
                    conn.query(
                        "SELECT table_schema, table_name \
                         FROM information_schema.tables \
                         WHERE table_type = 'BASE TABLE' \
                           AND table_schema NOT IN ('pg_catalog', 'information_schema') \
                         ORDER BY table_schema, table_name",
                        &[],
                    )
                    .await
                }
            };
            query.map_err(map_pg_err).map(|rows| {
                rows.into_iter()
                    .map(|row| TableInfo {
                        schema: row.get(0),
                        name: row.get(1),
                    })
                    .collect()
            })
        })
        .await
    }

    async fn list_columns(
        &self,
        schema: Option<&str>,
        table: Option<&str>,
        table_type: Option<&str>,
    ) -> Result<Vec<ColumnInfo>, String> {
        let conn = self.get_conn().await?;
        let type_filter = table_type.unwrap_or("BASE TABLE");
        self.timed(async {
            let result = match (schema, table) {
                (Some(s), Some(t)) => {
                    conn.query(
                        "SELECT c.table_schema, c.table_name, c.column_name, c.data_type \
                         FROM information_schema.columns c \
                         WHERE c.table_schema = $1 AND c.table_name = $2 \
                         ORDER BY c.ordinal_position",
                        &[&s, &t],
                    )
                    .await
                }
                (Some(s), None) => {
                    conn.query(
                        "SELECT c.table_schema, c.table_name, c.column_name, c.data_type \
                         FROM information_schema.columns c \
                         JOIN information_schema.tables t \
                           ON c.table_schema = t.table_schema AND c.table_name = t.table_name \
                         WHERE t.table_type = $1 AND c.table_schema = $2 \
                         ORDER BY c.table_schema, c.table_name, c.ordinal_position",
                        &[&type_filter, &s],
                    )
                    .await
                }
                _ => {
                    conn.query(
                        "SELECT c.table_schema, c.table_name, c.column_name, c.data_type \
                         FROM information_schema.columns c \
                         JOIN information_schema.tables t \
                           ON c.table_schema = t.table_schema AND c.table_name = t.table_name \
                         WHERE t.table_type = $1 \
                           AND c.table_schema NOT IN ('pg_catalog', 'information_schema') \
                         ORDER BY c.table_schema, c.table_name, c.ordinal_position",
                        &[&type_filter],
                    )
                    .await
                }
            };
            result.map_err(map_pg_err).map(|rows| {
                rows.into_iter()
                    .map(|row| ColumnInfo {
                        schema: row.get(0),
                        table: row.get(1),
                        name: row.get(2),
                        data_type: row.get(3),
                    })
                    .collect()
            })
        })
        .await
    }

    async fn fetch_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
        limit: i64,
        offset: i64,
        order_by: Option<&str>,
        order_desc: bool,
        is_view: bool,
    ) -> Result<TableData, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let column_rows = conn
                .query(
                    "SELECT column_name \
                     FROM information_schema.columns \
                     WHERE table_schema = $1 AND table_name = $2 \
                     ORDER BY ordinal_position",
                    &[&schema, &table],
                )
                .await
                .map_err(map_pg_err)?;
            let columns: Vec<String> = column_rows.iter().map(|row| row.get(0)).collect();

            let where_clause = match filter {
                Some(expression) if !expression.trim().is_empty() => {
                    format!(" WHERE {}", expression.trim())
                }
                _ => String::new(),
            };
            let order_clause = match order_by {
                Some(column) if columns.iter().any(|name| name == column) => {
                    let direction = if order_desc { "DESC" } else { "ASC" };
                    format!(" ORDER BY t.{} {}", quote_ident(column), direction)
                }
                _ => String::new(),
            };
            let sql_with_ctid = format!(
                "SELECT to_jsonb(t) || jsonb_build_object('__ctid__', t.ctid::text) FROM {}.{} AS t{}{} LIMIT $1 OFFSET $2",
                quote_ident(schema),
                quote_ident(table),
                where_clause,
                order_clause,
            );
            let sql_without_ctid = format!(
                "SELECT to_jsonb(t) FROM {}.{} AS t{}{} LIMIT $1 OFFSET $2",
                quote_ident(schema),
                quote_ident(table),
                where_clause,
                order_clause,
            );

            let sql = if is_view { &sql_without_ctid } else { &sql_with_ctid };
            let data_rows = match conn.query(sql, &[&limit, &offset]).await {
                Ok(rows) => rows,
                Err(_) if !is_view => {
                    conn.query(&sql_without_ctid, &[&limit, &offset])
                        .await
                        .map_err(map_pg_err)?
                }
                Err(e) => return Err(map_pg_err(e)),
            };
            let rows: Vec<serde_json::Value> = data_rows.iter().map(|row| row.get(0)).collect();

            Ok(TableData { columns, rows })
        })
        .await
    }

    async fn count_rows(
        &self,
        schema: &str,
        table: &str,
        filter: Option<&str>,
    ) -> Result<i64, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let where_clause = match filter {
                Some(expression) if !expression.trim().is_empty() => {
                    format!(" WHERE {}", expression.trim())
                }
                _ => String::new(),
            };
            let sql = format!(
                "SELECT COUNT(*) FROM {}.{}{}",
                quote_ident(schema),
                quote_ident(table),
                where_clause,
            );
            conn.query_one(&sql, &[])
                .await
                .map_err(map_pg_err)
                .map(|row| row.get::<_, i64>(0))
        })
        .await
    }

    async fn update_row(
        &self,
        schema: &str,
        table: &str,
        ctid: &str,
        updates: &std::collections::HashMap<String, Option<String>>,
    ) -> Result<(), String> {
        let ctid = ctid.trim();
        let ctid_valid = ctid.starts_with('(') && ctid.ends_with(')') && {
            let inner = &ctid[1..ctid.len() - 1];
            let parts: Vec<&str> = inner.splitn(2, ',').collect();
            parts.len() == 2
                && parts[0].trim().parse::<u64>().is_ok()
                && parts[1].trim().parse::<u64>().is_ok()
        };
        if !ctid_valid {
            return Err("Ungültige ctid".to_string());
        }

        let conn = self.get_conn().await?;
        self.timed(async {
            let col_rows = conn
                .query(
                    "SELECT column_name FROM information_schema.columns \
                     WHERE table_schema = $1 AND table_name = $2",
                    &[&schema, &table],
                )
                .await
                .map_err(map_pg_err)?;

            let valid_columns: std::collections::HashSet<String> =
                col_rows.iter().map(|r| r.get::<_, String>(0)).collect();

            let mut set_parts: Vec<String> = Vec::new();
            for (col, val) in updates {
                if !valid_columns.contains(col) {
                    return Err(format!("Unbekannte Spalte: {col}"));
                }
                let sql_val = match val {
                    None => "NULL".to_string(),
                    Some(s) => format!("'{}'", s.replace('\'', "''")),
                };
                set_parts.push(format!("{} = {}", quote_ident(col), sql_val));
            }

            if set_parts.is_empty() {
                return Ok(());
            }

            let sql = format!(
                "UPDATE {}.{} SET {} WHERE ctid = '{}'::tid",
                quote_ident(schema),
                quote_ident(table),
                set_parts.join(", "),
                ctid,
            );

            conn.execute(sql.as_str(), &[])
                .await
                .map(|_| ())
                .map_err(map_pg_err)
        })
        .await
    }

    async fn execute_query(&self, sql: &str) -> Result<QueryResult, String> {
        let conn = self.get_conn().await?;
        let start = std::time::Instant::now();

        self.timed(async {
            let messages = conn.simple_query(sql).await.map_err(map_pg_err)?;
            let elapsed = start.elapsed().as_millis() as u64;

            let mut columns: Vec<String> = Vec::new();
            let mut rows: Vec<serde_json::Value> = Vec::new();
            let mut rows_affected: Option<u64> = None;

            for msg in messages {
                match msg {
                    SimpleQueryMessage::Row(row) => {
                        if columns.is_empty() {
                            columns = row
                                .columns()
                                .iter()
                                .map(|c| c.name().to_string())
                                .collect();
                        }
                        let mut obj = serde_json::Map::new();
                        for (i, col) in columns.iter().enumerate() {
                            let val = row
                                .get(i)
                                .map(|v| serde_json::Value::String(v.to_string()))
                                .unwrap_or(serde_json::Value::Null);
                            obj.insert(col.clone(), val);
                        }
                        rows.push(serde_json::Value::Object(obj));
                    }
                    SimpleQueryMessage::CommandComplete(count) => {
                        rows_affected = Some(count);
                    }
                    _ => {}
                }
            }

            Ok(QueryResult {
                columns,
                rows,
                rows_affected,
                execution_time_ms: elapsed,
            })
        })
        .await
    }

    async fn list_views(&self, schema: Option<&str>) -> Result<Vec<TableInfo>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let query = match schema {
                Some(schema) => {
                    conn.query(
                        "SELECT table_schema, table_name \
                         FROM information_schema.views \
                         WHERE table_schema = $1 \
                         ORDER BY table_name",
                        &[&schema],
                    )
                    .await
                }
                None => {
                    conn.query(
                        "SELECT table_schema, table_name \
                         FROM information_schema.views \
                         WHERE table_schema NOT IN ('pg_catalog', 'information_schema') \
                         ORDER BY table_schema, table_name",
                        &[],
                    )
                    .await
                }
            };
            query.map_err(map_pg_err).map(|rows| {
                rows.into_iter()
                    .map(|row| TableInfo {
                        schema: row.get(0),
                        name: row.get(1),
                    })
                    .collect()
            })
        })
        .await
    }

    async fn get_view_definition(
        &self,
        schema: &str,
        view: &str,
    ) -> Result<String, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            conn.query_one(
                "SELECT pg_get_viewdef(c.oid, true) \
                 FROM pg_class c \
                 JOIN pg_namespace n ON n.oid = c.relnamespace \
                 WHERE n.nspname = $1 AND c.relname = $2 AND c.relkind IN ('v', 'm')",
                &[&schema, &view],
            )
            .await
            .map_err(map_pg_err)
            .map(|row| row.get::<_, String>(0))
        })
        .await
    }

    async fn update_view_definition(
        &self,
        schema: &str,
        view: &str,
        body: &str,
        dry_run: bool,
    ) -> Result<(), String> {
        let conn = self.get_conn().await?;
        let ddl = format!(
            "CREATE OR REPLACE VIEW {}.{} AS {}",
            quote_ident(schema),
            quote_ident(view),
            body
        );
        self.timed(async {
            if dry_run {
                conn.simple_query("BEGIN").await.map_err(map_pg_err)?;
                let result = conn.simple_query(&ddl).await.map_err(map_pg_err);
                let _ = conn.simple_query("ROLLBACK").await;
                result.map(|_| ())
            } else {
                conn.simple_query(&ddl).await.map_err(map_pg_err).map(|_| ())
            }
        })
        .await
    }

    async fn list_functions(&self, schema: Option<&str>) -> Result<Vec<FunctionInfo>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let query = match schema {
                Some(schema) => {
                    conn.query(
                        "SELECT n.nspname, p.proname, \
                                pg_catalog.pg_get_function_identity_arguments(p.oid), \
                                pg_catalog.pg_get_function_result(p.oid), \
                                l.lanname, \
                                p.oid::text \
                         FROM pg_catalog.pg_proc p \
                         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace \
                         JOIN pg_catalog.pg_language l ON l.oid = p.prolang \
                         WHERE n.nspname = $1 AND p.prokind IN ('f', 'p') \
                         ORDER BY p.proname",
                        &[&schema],
                    )
                    .await
                }
                None => {
                    conn.query(
                        "SELECT n.nspname, p.proname, \
                                pg_catalog.pg_get_function_identity_arguments(p.oid), \
                                pg_catalog.pg_get_function_result(p.oid), \
                                l.lanname, \
                                p.oid::text \
                         FROM pg_catalog.pg_proc p \
                         JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace \
                         JOIN pg_catalog.pg_language l ON l.oid = p.prolang \
                         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') \
                               AND p.prokind IN ('f', 'p') \
                         ORDER BY n.nspname, p.proname",
                        &[],
                    )
                    .await
                }
            };
            query.map_err(map_pg_err).map(|rows| {
                rows.into_iter()
                    .map(|row| FunctionInfo {
                        schema: row.get(0),
                        name: row.get(1),
                        identity_args: row.get(2),
                        return_type: row.get(3),
                        language: row.get(4),
                        oid: row.get(5),
                    })
                    .collect()
            })
        })
        .await
    }

    async fn get_function_definition(&self, oid: &str) -> Result<String, String> {
        let conn = self.get_conn().await?;
        let oid_val: u32 = oid
            .parse()
            .map_err(|_| format!("Ungültige OID: {oid}"))?;
        self.timed(async {
            conn.query_one(
                "SELECT pg_get_functiondef($1::oid)",
                &[&oid_val],
            )
            .await
            .map_err(map_pg_err)
            .map(|row| row.get::<_, String>(0))
        })
        .await
    }

    async fn list_extensions(&self) -> Result<Vec<ExtensionInfo>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            conn.query(
                "SELECT e.extname, \
                        e.extversion, \
                        n.nspname, \
                        c.description \
                 FROM pg_extension e \
                 JOIN pg_namespace n ON n.oid = e.extnamespace \
                 LEFT JOIN pg_description c \
                   ON c.objoid = e.oid \
                   AND c.classoid = 'pg_extension'::regclass \
                 ORDER BY e.extname",
                &[],
            )
            .await
            .map_err(map_pg_err)
            .map(|rows| {
                rows.into_iter()
                    .map(|row| ExtensionInfo {
                        name: row.get(0),
                        version: row.get(1),
                        schema: row.get(2),
                        description: row.get(3),
                    })
                    .collect()
            })
        })
        .await
    }

    async fn list_roles(&self) -> Result<Vec<RoleInfo>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let role_rows = conn
                .query(
                    "SELECT r.rolname, r.oid::text, r.rolsuper, r.rolcanlogin, \
                            r.rolcreatedb, r.rolcreaterole, r.rolreplication, \
                            r.rolbypassrls, r.rolconnlimit, \
                            r.rolvaliduntil::text \
                     FROM pg_roles r \
                     ORDER BY r.rolname",
                    &[],
                )
                .await
                .map_err(map_pg_err)?;

            let membership_rows = conn
                .query(
                    "SELECT m.oid::text, g.rolname \
                     FROM pg_auth_members am \
                     JOIN pg_roles m ON m.oid = am.member \
                     JOIN pg_roles g ON g.oid = am.roleid",
                    &[],
                )
                .await
                .map_err(map_pg_err)?;

            let mut member_of_map: std::collections::HashMap<String, Vec<String>> =
                std::collections::HashMap::new();
            let mut members_map: std::collections::HashMap<String, Vec<String>> =
                std::collections::HashMap::new();

            for row in &membership_rows {
                let member_oid: String = row.get(0);
                let group_name: String = row.get(1);
                member_of_map
                    .entry(member_oid)
                    .or_default()
                    .push(group_name.clone());

                let member_name: String = role_rows
                    .iter()
                    .find(|r| r.get::<_, String>(1) == row.get::<_, String>(0))
                    .map(|r| r.get::<_, String>(0))
                    .unwrap_or_default();
                if !member_name.is_empty() {
                    members_map
                        .entry(group_name)
                        .or_default()
                        .push(member_name);
                }
            }

            let roles = role_rows
                .into_iter()
                .map(|row| {
                    let oid: String = row.get(1);
                    let name: String = row.get(0);
                    RoleInfo {
                        name: name.clone(),
                        oid: oid.clone(),
                        superuser: row.get(2),
                        can_login: row.get(3),
                        create_db: row.get(4),
                        create_role: row.get(5),
                        replication: row.get(6),
                        bypass_rls: row.get(7),
                        conn_limit: row.get(8),
                        valid_until: row.get(9),
                        member_of: member_of_map.remove(&oid).unwrap_or_default(),
                        members: members_map.remove(&name).unwrap_or_default(),
                    }
                })
                .collect();

            Ok(roles)
        })
        .await
    }

    async fn create_role(&self, options: &CreateRoleOptions) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let mut parts = vec![format!("CREATE ROLE {}", quote_ident(&options.name))];
            let mut with_opts = Vec::new();

            if options.can_login {
                with_opts.push("LOGIN".to_string());
            } else {
                with_opts.push("NOLOGIN".to_string());
            }
            if options.superuser {
                with_opts.push("SUPERUSER".to_string());
            }
            if options.create_db {
                with_opts.push("CREATEDB".to_string());
            }
            if options.create_role {
                with_opts.push("CREATEROLE".to_string());
            }
            if options.replication {
                with_opts.push("REPLICATION".to_string());
            }
            if options.bypass_rls {
                with_opts.push("BYPASSRLS".to_string());
            }
            if let Some(limit) = options.conn_limit {
                with_opts.push(format!("CONNECTION LIMIT {limit}"));
            }
            if let Some(ref password) = options.password {
                if !password.is_empty() {
                    with_opts.push(format!("PASSWORD '{}'", password.replace('\'', "''")));
                }
            }
            if let Some(ref valid) = options.valid_until {
                if !valid.is_empty() {
                    with_opts.push(format!("VALID UNTIL '{}'", valid.replace('\'', "''")));
                }
            }

            if !with_opts.is_empty() {
                parts.push(format!("WITH {}", with_opts.join(" ")));
            }

            let sql = parts.join(" ");
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;

            for role in &options.member_of {
                let grant_sql = format!(
                    "GRANT {} TO {}",
                    quote_ident(role),
                    quote_ident(&options.name)
                );
                conn.execute(grant_sql.as_str(), &[])
                    .await
                    .map_err(map_pg_err)?;
            }

            Ok(())
        })
        .await
    }

    async fn alter_role(&self, options: &AlterRoleOptions) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let mut with_opts = Vec::new();

            if let Some(v) = options.superuser {
                with_opts.push(if v { "SUPERUSER" } else { "NOSUPERUSER" }.to_string());
            }
            if let Some(v) = options.can_login {
                with_opts.push(if v { "LOGIN" } else { "NOLOGIN" }.to_string());
            }
            if let Some(v) = options.create_db {
                with_opts.push(if v { "CREATEDB" } else { "NOCREATEDB" }.to_string());
            }
            if let Some(v) = options.create_role {
                with_opts.push(if v { "CREATEROLE" } else { "NOCREATEROLE" }.to_string());
            }
            if let Some(v) = options.replication {
                with_opts.push(if v { "REPLICATION" } else { "NOREPLICATION" }.to_string());
            }
            if let Some(v) = options.bypass_rls {
                with_opts.push(if v { "BYPASSRLS" } else { "NOBYPASSRLS" }.to_string());
            }
            if let Some(limit) = options.conn_limit {
                with_opts.push(format!("CONNECTION LIMIT {limit}"));
            }
            if let Some(ref password) = options.password {
                if !password.is_empty() {
                    with_opts.push(format!("PASSWORD '{}'", password.replace('\'', "''")));
                }
            }
            if options.clear_valid_until {
                with_opts.push("VALID UNTIL 'infinity'".to_string());
            } else if let Some(ref valid) = options.valid_until {
                if !valid.is_empty() {
                    with_opts.push(format!("VALID UNTIL '{}'", valid.replace('\'', "''")));
                }
            }

            if !with_opts.is_empty() {
                let sql = format!(
                    "ALTER ROLE {} WITH {}",
                    quote_ident(&options.name),
                    with_opts.join(" ")
                );
                conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            }

            for role in &options.grant_roles {
                let sql = format!(
                    "GRANT {} TO {}",
                    quote_ident(role),
                    quote_ident(&options.name)
                );
                conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            }

            for role in &options.revoke_roles {
                let sql = format!(
                    "REVOKE {} FROM {}",
                    quote_ident(role),
                    quote_ident(&options.name)
                );
                conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            }

            Ok(())
        })
        .await
    }

    async fn drop_role(&self, name: &str) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let sql = format!("DROP ROLE {}", quote_ident(name));
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn drop_table(&self, schema: &str, table: &str) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let sql = format!("DROP TABLE {}.{} CASCADE", quote_ident(schema), quote_ident(table));
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let sql = format!("TRUNCATE TABLE {}.{}", quote_ident(schema), quote_ident(table));
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn list_role_privileges(&self, role_name: &str) -> Result<RolePrivileges, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let schema_rows = conn
                .query(
                    "SELECT n.nspname, \
                            has_schema_privilege($1, n.nspname, 'USAGE') AS usage_priv, \
                            has_schema_privilege($1, n.nspname, 'CREATE') AS create_priv \
                     FROM pg_namespace n \
                     WHERE n.nspname NOT LIKE 'pg_%' \
                       AND n.nspname <> 'information_schema' \
                     ORDER BY n.nspname",
                    &[&role_name],
                )
                .await
                .map_err(map_pg_err)?;

            let schemas: Vec<SchemaPrivileges> = schema_rows
                .iter()
                .map(|row| SchemaPrivileges {
                    schema: row.get(0),
                    usage: row.get(1),
                    create: row.get(2),
                })
                .collect();

            let table_rows = conn
                .query(
                    "SELECT c.relnamespace::regnamespace::text AS schema_name, \
                            c.relname, \
                            CASE c.relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' \
                                           WHEN 'm' THEN 'materialized_view' WHEN 'S' THEN 'sequence' \
                                           ELSE 'other' END AS object_type, \
                            has_table_privilege($1, c.oid, 'SELECT') AS sel, \
                            has_table_privilege($1, c.oid, 'INSERT') AS ins, \
                            has_table_privilege($1, c.oid, 'UPDATE') AS upd, \
                            has_table_privilege($1, c.oid, 'DELETE') AS del, \
                            has_table_privilege($1, c.oid, 'TRUNCATE') AS trunc, \
                            has_table_privilege($1, c.oid, 'REFERENCES') AS refs, \
                            has_table_privilege($1, c.oid, 'TRIGGER') AS trig \
                     FROM pg_class c \
                     JOIN pg_namespace n ON n.oid = c.relnamespace \
                     WHERE c.relkind IN ('r', 'v', 'm', 'S') \
                       AND n.nspname NOT LIKE 'pg_%' \
                       AND n.nspname <> 'information_schema' \
                     ORDER BY n.nspname, c.relname",
                    &[&role_name],
                )
                .await
                .map_err(map_pg_err)?;

            let tables: Vec<TablePrivileges> = table_rows
                .iter()
                .map(|row| TablePrivileges {
                    schema: row.get(0),
                    table: row.get(1),
                    object_type: row.get(2),
                    select: row.get(3),
                    insert: row.get(4),
                    update: row.get(5),
                    delete: row.get(6),
                    truncate: row.get(7),
                    references: row.get(8),
                    trigger: row.get(9),
                })
                .collect();

            Ok(RolePrivileges { schemas, tables })
        })
        .await
    }

    async fn modify_privilege(&self, change: &PrivilegeChange) -> Result<(), String> {
        let valid_privileges = [
            "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE",
            "REFERENCES", "TRIGGER", "USAGE", "CREATE", "ALL PRIVILEGES",
        ];
        let priv_upper = change.privilege.to_uppercase();
        if !valid_privileges.contains(&priv_upper.as_str()) {
            return Err(format!("Ungültiges Privileg: {}", change.privilege));
        }

        let valid_object_types = ["schema", "table", "view", "materialized_view", "sequence"];
        if !valid_object_types.contains(&change.object_type.as_str()) {
            return Err(format!("Ungültiger Objekttyp: {}", change.object_type));
        }

        let conn = self.get_conn().await?;
        self.timed(async {
            let sql = match change.object_type.as_str() {
                "schema" => {
                    let schema = change.schema.as_deref()
                        .ok_or_else(|| "Schema fehlt".to_string())?;
                    if change.grant {
                        format!(
                            "GRANT {} ON SCHEMA {} TO {}",
                            priv_upper,
                            quote_ident(schema),
                            quote_ident(&change.role_name)
                        )
                    } else {
                        format!(
                            "REVOKE {} ON SCHEMA {} FROM {}",
                            priv_upper,
                            quote_ident(schema),
                            quote_ident(&change.role_name)
                        )
                    }
                }
                _ => {
                    let schema = change.schema.as_deref()
                        .ok_or_else(|| "Schema fehlt".to_string())?;
                    let table = change.table.as_deref()
                        .ok_or_else(|| "Tabelle fehlt".to_string())?;
                    if change.grant {
                        format!(
                            "GRANT {} ON {} TO {}",
                            priv_upper,
                            format!("{}.{}", quote_ident(schema), quote_ident(table)),
                            quote_ident(&change.role_name)
                        )
                    } else {
                        format!(
                            "REVOKE {} ON {} FROM {}",
                            priv_upper,
                            format!("{}.{}", quote_ident(schema), quote_ident(table)),
                            quote_ident(&change.role_name)
                        )
                    }
                }
            };
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn validate_sql(&self, sql: &str) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            conn.simple_query("BEGIN").await.map_err(map_pg_err)?;
            let result = conn.simple_query(sql).await.map_err(map_pg_err);
            let _ = conn.simple_query("ROLLBACK").await;
            result.map(|_| ())
        })
        .await
    }

    async fn list_foreign_keys(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ForeignKeyInfo>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            conn.query(
                "SELECT \
                     con.conname, \
                     ns_from.nspname, \
                     cl_from.relname, \
                     att_from.attname, \
                     ns_to.nspname, \
                     cl_to.relname, \
                     att_to.attname \
                 FROM pg_constraint con \
                 JOIN pg_class cl_from ON con.conrelid = cl_from.oid \
                 JOIN pg_namespace ns_from ON cl_from.relnamespace = ns_from.oid \
                 JOIN pg_class cl_to ON con.confrelid = cl_to.oid \
                 JOIN pg_namespace ns_to ON cl_to.relnamespace = ns_to.oid \
                 CROSS JOIN LATERAL unnest(con.conkey, con.confkey) \
                     WITH ORDINALITY AS u(from_attnum, to_attnum, ord) \
                 JOIN pg_attribute att_from \
                     ON att_from.attrelid = con.conrelid AND att_from.attnum = u.from_attnum \
                 JOIN pg_attribute att_to \
                     ON att_to.attrelid = con.confrelid AND att_to.attnum = u.to_attnum \
                 WHERE con.contype = 'f' \
                   AND ( \
                       (ns_from.nspname = $1 AND cl_from.relname = $2) \
                       OR (ns_to.nspname = $1 AND cl_to.relname = $2) \
                   ) \
                 ORDER BY con.conname, u.ord",
                &[&schema, &table],
            )
            .await
            .map_err(map_pg_err)
            .map(|rows| {
                rows.into_iter()
                    .map(|row| ForeignKeyInfo {
                        constraint_name: row.get(0),
                        from_schema: row.get(1),
                        from_table: row.get(2),
                        from_column: row.get(3),
                        to_schema: row.get(4),
                        to_table: row.get(5),
                        to_column: row.get(6),
                    })
                    .collect()
            })
        })
        .await
    }

    async fn get_er_schema(&self, schema: Option<&str>) -> Result<ERSchema, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let schema_filter = schema.unwrap_or("public");

            let col_rows = conn
                .query(
                    "SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable, \
                         CASE WHEN pk.column_name IS NOT NULL THEN true ELSE false END AS is_pk \
                     FROM information_schema.columns c \
                     JOIN information_schema.tables t \
                       ON c.table_schema = t.table_schema AND c.table_name = t.table_name \
                     LEFT JOIN ( \
                         SELECT ku.table_schema, ku.table_name, ku.column_name \
                         FROM information_schema.table_constraints tc \
                         JOIN information_schema.key_column_usage ku \
                           ON tc.constraint_name = ku.constraint_name \
                          AND tc.table_schema = ku.table_schema \
                         WHERE tc.constraint_type = 'PRIMARY KEY' \
                     ) pk ON pk.table_schema = c.table_schema \
                         AND pk.table_name = c.table_name \
                         AND pk.column_name = c.column_name \
                     WHERE t.table_type = 'BASE TABLE' AND c.table_schema = $1 \
                     ORDER BY c.table_schema, c.table_name, c.ordinal_position",
                    &[&schema_filter],
                )
                .await
                .map_err(map_pg_err)?;

            let mut tables: Vec<ERTable> = Vec::new();
            let mut current_key = String::new();

            for row in &col_rows {
                let tbl_schema: String = row.get(0);
                let tbl_name: String = row.get(1);
                let key = format!("{}.{}", tbl_schema, tbl_name);

                let col = ERColumn {
                    name: row.get(2),
                    data_type: row.get(3),
                    is_nullable: row.get::<_, String>(4) == "YES",
                    is_primary_key: row.get(5),
                };

                if key != current_key {
                    tables.push(ERTable {
                        schema: tbl_schema,
                        name: tbl_name,
                        columns: vec![col],
                    });
                    current_key = key;
                } else if let Some(last) = tables.last_mut() {
                    last.columns.push(col);
                }
            }

            let fk_rows = conn
                .query(
                    "SELECT \
                         con.conname, \
                         ns_from.nspname, \
                         cl_from.relname, \
                         att_from.attname, \
                         ns_to.nspname, \
                         cl_to.relname, \
                         att_to.attname \
                     FROM pg_constraint con \
                     JOIN pg_class cl_from ON con.conrelid = cl_from.oid \
                     JOIN pg_namespace ns_from ON cl_from.relnamespace = ns_from.oid \
                     JOIN pg_class cl_to ON con.confrelid = cl_to.oid \
                     JOIN pg_namespace ns_to ON cl_to.relnamespace = ns_to.oid \
                     CROSS JOIN LATERAL unnest(con.conkey, con.confkey) \
                         WITH ORDINALITY AS u(from_attnum, to_attnum, ord) \
                     JOIN pg_attribute att_from \
                         ON att_from.attrelid = con.conrelid AND att_from.attnum = u.from_attnum \
                     JOIN pg_attribute att_to \
                         ON att_to.attrelid = con.confrelid AND att_to.attnum = u.to_attnum \
                     WHERE con.contype = 'f' \
                       AND (ns_from.nspname = $1 OR ns_to.nspname = $1) \
                     ORDER BY con.conname, u.ord",
                    &[&schema_filter],
                )
                .await
                .map_err(map_pg_err)?;

            let foreign_keys: Vec<ForeignKeyInfo> = fk_rows
                .into_iter()
                .map(|row| ForeignKeyInfo {
                    constraint_name: row.get(0),
                    from_schema: row.get(1),
                    from_table: row.get(2),
                    from_column: row.get(3),
                    to_schema: row.get(4),
                    to_table: row.get(5),
                    to_column: row.get(6),
                })
                .collect();

            Ok(ERSchema {
                tables,
                foreign_keys,
            })
        })
        .await
    }

    async fn list_triggers(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<TriggerInfo>, String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            conn.query(
                "SELECT \
                     t.tgname, \
                     n.nspname, \
                     c.relname, \
                     CASE \
                         WHEN t.tgtype::int & 4 = 4 THEN 'INSERT' \
                         WHEN t.tgtype::int & 8 = 8 THEN 'DELETE' \
                         WHEN t.tgtype::int & 16 = 16 THEN 'UPDATE' \
                         WHEN t.tgtype::int & 32 = 32 THEN 'TRUNCATE' \
                         ELSE 'UNKNOWN' \
                     END, \
                     CASE \
                         WHEN t.tgtype::int & 2 = 2 THEN 'BEFORE' \
                         WHEN t.tgtype::int & 64 = 64 THEN 'INSTEAD OF' \
                         ELSE 'AFTER' \
                     END, \
                     CASE \
                         WHEN t.tgtype::int & 1 = 1 THEN 'ROW' \
                         ELSE 'STATEMENT' \
                     END, \
                     pn.nspname, \
                     p.proname, \
                     CASE t.tgenabled \
                         WHEN 'O' THEN 'ORIGIN' \
                         WHEN 'D' THEN 'DISABLED' \
                         WHEN 'R' THEN 'REPLICA' \
                         WHEN 'A' THEN 'ALWAYS' \
                         ELSE 'ENABLED' \
                     END, \
                     pg_get_triggerdef(t.oid) \
                 FROM pg_trigger t \
                 JOIN pg_class c ON t.tgrelid = c.oid \
                 JOIN pg_namespace n ON c.relnamespace = n.oid \
                 JOIN pg_proc p ON t.tgfoid = p.oid \
                 JOIN pg_namespace pn ON p.pronamespace = pn.oid \
                 WHERE NOT t.tgisinternal \
                   AND n.nspname = $1 \
                   AND c.relname = $2 \
                 ORDER BY t.tgname",
                &[&schema, &table],
            )
            .await
            .map_err(map_pg_err)
            .map(|rows| {
                rows.into_iter()
                    .map(|row| TriggerInfo {
                        trigger_name: row.get(0),
                        table_schema: row.get(1),
                        table_name: row.get(2),
                        event: row.get(3),
                        timing: row.get(4),
                        orientation: row.get(5),
                        function_schema: row.get(6),
                        function_name: row.get(7),
                        enabled: row.get(8),
                        definition: row.get(9),
                    })
                    .collect()
            })
        })
        .await
    }
}
