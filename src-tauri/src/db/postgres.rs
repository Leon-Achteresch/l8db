use std::time::Duration;

use async_trait::async_trait;
use bb8::PooledConnection;
use bb8_postgres::PostgresConnectionManager;
use postgres_native_tls::MakeTlsConnector;
use tokio::time::timeout;
use tokio_postgres::{Config, SimpleQueryMessage};

use super::pool::{PoolState, PoolUse};
use super::{
    map_pg_err, quote_ident, quote_literal, redact_connection_string, validate_table_filter,
    AddColumnRequest, AlterColumnRequest, AlterRoleOptions, AlterSequenceRequest,
    AvailableExtensionInfo, ColumnInfo, ConnectionConfig, ConstraintInfo, CreateRoleOptions,
    DatabaseAdapter, DetailedColumnInfo, ERColumn, ERSchema, ERTable, ExtensionInfo,
    ForeignKeyInfo, FunctionInfo, IndexInfo, PrivilegeChange, QueryResult, RoleInfo,
    RolePrivileges, SchemaPrivileges, SequenceInfo, SslMode, TableData, TableInfo, TablePrivileges,
    TriggerInfo,
};

const QUERY_TIMEOUT: Duration = Duration::from_secs(30);

pub struct PostgresAdapter {
    config: Config,
    pool_state: PoolState,
    pool_key: String,
    ssl: SslMode,
}

impl PostgresAdapter {
    pub fn from_config(config: ConnectionConfig, pool_state: PoolState) -> Self {
        let ssl = config.ssl_mode.unwrap_or(SslMode::Prefer);
        let mut pg = Config::new();
        pg.host(&config.host)
            .port(config.port)
            .user(&config.user)
            .password(&config.password)
            .dbname(&config.database)
            .ssl_mode(ssl.to_pg())
            .connect_timeout(Duration::from_secs(10));
        let pool_key = super::connection::connection_key(
            &format!("{pg:?}{:?}{}", config.password, ssl.as_url_param()),
            None,
        );
        Self {
            config: pg,
            pool_state,
            pool_key,
            ssl,
        }
    }

    pub fn from_connection_string(
        connection_string: &str,
        database: Option<&str>,
        pool_state: PoolState,
    ) -> Result<Self, String> {
        let (config, ssl) = super::connection::parse_connection(connection_string, database)?;
        let pool_key = super::connection::connection_key(connection_string, database);
        Ok(Self {
            config,
            pool_state,
            pool_key,
            ssl,
        })
    }

    async fn get_conn(
        &self,
    ) -> Result<PooledConnection<'static, PostgresConnectionManager<MakeTlsConnector>>, String>
    {
        let pool = self
            .pool_state
            .get_pool(
                &self.pool_key,
                self.config.clone(),
                self.ssl,
                PoolUse::Query,
            )
            .await?;
        pool.get_owned()
            .await
            .map_err(|e| format!("Verbindung fehlgeschlagen: {e}"))
    }

    async fn get_meta(
        &self,
    ) -> Result<PooledConnection<'static, PostgresConnectionManager<MakeTlsConnector>>, String>
    {
        let pool = self
            .pool_state
            .get_pool(
                &self.pool_key,
                self.config.clone(),
                self.ssl,
                PoolUse::Metadata,
            )
            .await?;
        pool.get_owned()
            .await
            .map_err(|e| format!("Verbindung fehlgeschlagen: {e}"))
    }

    async fn timed<F, T>(&self, future: F) -> Result<T, String>
    where
        F: std::future::Future<Output = Result<T, String>>,
    {
        timeout(QUERY_TIMEOUT, future).await.map_err(|_| {
            "Query-Timeout: Die Abfrage hat länger als 30 Sekunden gedauert".to_string()
        })?
    }
}

#[async_trait]
impl DatabaseAdapter for PostgresAdapter {
    async fn test_connection(&self) -> Result<(), String> {
        self.timed(async {
            let (client, connection) = self
                .config
                .connect(super::connection::tls_connector(self.ssl)?)
                .await
                .map_err(map_pg_err)?;
            let task = tokio::spawn(async move {
                let _ = connection.await;
            });
            let result = client
                .simple_query("SELECT 1")
                .await
                .map(|_| ())
                .map_err(map_pg_err);
            drop(client);
            task.abort();
            result
        })
        .await
    }

    async fn list_databases(&self) -> Result<Vec<String>, String> {
        let conn = self.get_meta().await?;
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
        let conn = self.get_meta().await?;
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
        let conn = self.get_meta().await?;
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
        let conn = self.get_meta().await?;
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
        allow_raw_filter: bool,
    ) -> Result<TableData, String> {
        let trimmed = filter.map(str::trim).filter(|f| !f.is_empty());
        if !allow_raw_filter {
            if let Some(expression) = trimmed {
                validate_table_filter(expression)?;
            }
        }
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
        allow_raw_filter: bool,
    ) -> Result<i64, String> {
        let trimmed = filter.map(str::trim).filter(|f| !f.is_empty());
        if !allow_raw_filter {
            if let Some(expression) = trimmed {
                validate_table_filter(expression)?;
            }
        }
        let conn = self.get_meta().await?;
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
                            columns = row.columns().iter().map(|c| c.name().to_string()).collect();
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
        let conn = self.get_meta().await?;
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

    async fn get_view_definition(&self, schema: &str, view: &str) -> Result<String, String> {
        let conn = self.get_meta().await?;
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
                conn.simple_query(&ddl)
                    .await
                    .map_err(map_pg_err)
                    .map(|_| ())
            }
        })
        .await
    }

    async fn list_functions(&self, schema: Option<&str>) -> Result<Vec<FunctionInfo>, String> {
        let conn = self.get_meta().await?;
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
        let conn = self.get_meta().await?;
        let oid_val: u32 = oid.parse().map_err(|_| format!("Ungültige OID: {oid}"))?;
        self.timed(async {
            conn.query_one("SELECT pg_get_functiondef($1::oid)", &[&oid_val])
                .await
                .map_err(map_pg_err)
                .map(|row| row.get::<_, String>(0))
        })
        .await
    }

    async fn list_extensions(&self) -> Result<Vec<ExtensionInfo>, String> {
        let conn = self.get_meta().await?;
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
        let conn = self.get_meta().await?;
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
                    members_map.entry(group_name).or_default().push(member_name);
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
            let sql = format!(
                "DROP TABLE {}.{} CASCADE",
                quote_ident(schema),
                quote_ident(table)
            );
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn truncate_table(&self, schema: &str, table: &str) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let sql = format!(
                "TRUNCATE TABLE {}.{}",
                quote_ident(schema),
                quote_ident(table)
            );
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn list_table_columns_detailed(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<DetailedColumnInfo>, String> {
        let conn = self.get_meta().await?;
        self.timed(async {
            let rows = conn.query(
                "SELECT c.column_name, c.data_type, c.is_nullable, c.column_default, c.ordinal_position, \
                        c.character_maximum_length, \
                        COALESCE(( \
                            SELECT true FROM information_schema.table_constraints tc \
                            JOIN information_schema.key_column_usage kcu \
                              ON tc.constraint_name = kcu.constraint_name \
                             AND tc.table_schema = kcu.table_schema \
                            WHERE tc.constraint_type = 'PRIMARY KEY' \
                              AND tc.table_schema = c.table_schema \
                              AND tc.table_name = c.table_name \
                              AND kcu.column_name = c.column_name \
                        ), false) AS is_primary_key \
                 FROM information_schema.columns c \
                 WHERE c.table_schema = $1 AND c.table_name = $2 \
                 ORDER BY c.ordinal_position",
                &[&schema, &table],
            ).await.map_err(map_pg_err)?;
            Ok(rows.iter().map(|r| {
                let nullable: String = r.get("is_nullable");
                let ordinal: i32 = r.get("ordinal_position");
                DetailedColumnInfo {
                    name: r.get("column_name"),
                    data_type: r.get("data_type"),
                    is_nullable: nullable == "YES",
                    column_default: r.get("column_default"),
                    is_primary_key: r.get("is_primary_key"),
                    ordinal_position: ordinal,
                    character_maximum_length: r.get("character_maximum_length"),
                }
            }).collect())
        }).await
    }

    async fn add_column(
        &self,
        schema: &str,
        table: &str,
        column: &AddColumnRequest,
    ) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let mut sql = format!(
                "ALTER TABLE {}.{} ADD COLUMN {} {}",
                quote_ident(schema),
                quote_ident(table),
                quote_ident(&column.name),
                column.data_type
            );
            if !column.is_nullable {
                sql.push_str(" NOT NULL");
            }
            if let Some(ref def) = column.default_value {
                sql.push_str(&format!(" DEFAULT {def}"));
            }
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn alter_column(
        &self,
        schema: &str,
        table: &str,
        changes: &AlterColumnRequest,
    ) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let tbl = format!("{}.{}", quote_ident(schema), quote_ident(table));
            let col = quote_ident(&changes.old_name);
            let mut stmts: Vec<String> = Vec::new();
            if let Some(ref dt) = changes.data_type {
                stmts.push(format!("ALTER TABLE {tbl} ALTER COLUMN {col} TYPE {dt}"));
            }
            if let Some(not_null) = changes.set_not_null {
                if not_null {
                    stmts.push(format!("ALTER TABLE {tbl} ALTER COLUMN {col} SET NOT NULL"));
                } else {
                    stmts.push(format!(
                        "ALTER TABLE {tbl} ALTER COLUMN {col} DROP NOT NULL"
                    ));
                }
            }
            if changes.drop_default {
                stmts.push(format!("ALTER TABLE {tbl} ALTER COLUMN {col} DROP DEFAULT"));
            } else if let Some(ref def) = changes.new_default {
                stmts.push(format!(
                    "ALTER TABLE {tbl} ALTER COLUMN {col} SET DEFAULT {def}"
                ));
            }
            if let Some(ref new_name) = changes.new_name {
                stmts.push(format!(
                    "ALTER TABLE {tbl} RENAME COLUMN {col} TO {}",
                    quote_ident(new_name)
                ));
            }
            for stmt in &stmts {
                conn.execute(stmt.as_str(), &[]).await.map_err(map_pg_err)?;
            }
            Ok(())
        })
        .await
    }

    async fn drop_column(&self, schema: &str, table: &str, column: &str) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let sql = format!(
                "ALTER TABLE {}.{} DROP COLUMN {} CASCADE",
                quote_ident(schema),
                quote_ident(table),
                quote_ident(column)
            );
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn list_role_privileges(&self, role_name: &str) -> Result<RolePrivileges, String> {
        let conn = self.get_meta().await?;
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
            "SELECT",
            "INSERT",
            "UPDATE",
            "DELETE",
            "TRUNCATE",
            "REFERENCES",
            "TRIGGER",
            "USAGE",
            "CREATE",
            "ALL PRIVILEGES",
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
                    let schema = change
                        .schema
                        .as_deref()
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
                    let schema = change
                        .schema
                        .as_deref()
                        .ok_or_else(|| "Schema fehlt".to_string())?;
                    let table = change
                        .table
                        .as_deref()
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
        let conn = self.get_meta().await?;
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
        let conn = self.get_meta().await?;
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
        let conn = self.get_meta().await?;
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

    async fn list_triggers(&self, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, String> {
        let conn = self.get_meta().await?;
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

    async fn list_sequences(&self, schema: Option<&str>) -> Result<Vec<SequenceInfo>, String> {
        let conn = self.get_meta().await?;
        self.timed(async {
            let query = match schema {
                Some(s) => {
                    conn.query(
                        "SELECT schemaname, sequencename, data_type::text, \
                                start_value::text, min_value::text, max_value::text, \
                                increment_by::text, cycle, last_value::text \
                         FROM pg_sequences \
                         WHERE schemaname = $1 \
                         ORDER BY sequencename",
                        &[&s],
                    )
                    .await
                }
                None => {
                    conn.query(
                        "SELECT schemaname, sequencename, data_type::text, \
                                start_value::text, min_value::text, max_value::text, \
                                increment_by::text, cycle, last_value::text \
                         FROM pg_sequences \
                         WHERE schemaname NOT IN ('pg_catalog', 'information_schema') \
                         ORDER BY schemaname, sequencename",
                        &[],
                    )
                    .await
                }
            };
            query.map_err(map_pg_err).map(|rows| {
                rows.into_iter()
                    .map(|row| SequenceInfo {
                        schema: row.get(0),
                        name: row.get(1),
                        data_type: row.get(2),
                        start_value: row.get(3),
                        min_value: row.get(4),
                        max_value: row.get(5),
                        increment_by: row.get(6),
                        cycle: row.get(7),
                        last_value: row.get(8),
                    })
                    .collect()
            })
        })
        .await
    }

    async fn alter_sequence(
        &self,
        schema: &str,
        name: &str,
        changes: &AlterSequenceRequest,
    ) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let mut parts: Vec<String> = Vec::new();
            if let Some(ref inc) = changes.increment_by {
                parts.push(format!("INCREMENT BY {}", inc.trim()));
            }
            match &changes.min_value {
                Some(v) if !v.trim().is_empty() => parts.push(format!("MINVALUE {}", v.trim())),
                Some(_) => parts.push("NO MINVALUE".to_string()),
                None => {}
            }
            match &changes.max_value {
                Some(v) if !v.trim().is_empty() => parts.push(format!("MAXVALUE {}", v.trim())),
                Some(_) => parts.push("NO MAXVALUE".to_string()),
                None => {}
            }
            if let Some(cycle) = changes.cycle {
                parts.push(if cycle {
                    "CYCLE".to_string()
                } else {
                    "NO CYCLE".to_string()
                });
            }
            if let Some(ref restart) = changes.restart_with {
                if !restart.trim().is_empty() {
                    parts.push(format!("RESTART WITH {}", restart.trim()));
                }
            }
            if parts.is_empty() {
                return Ok(());
            }
            let sql = format!(
                "ALTER SEQUENCE {}.{} {}",
                quote_ident(schema),
                quote_ident(name),
                parts.join(" ")
            );
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn list_indexes(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        self.list_indexes_impl(schema, table).await
    }

    async fn list_constraints(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>, String> {
        self.list_constraints_impl(schema, table).await
    }

    async fn install_extension(&self, name: &str, schema: Option<&str>) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let sql = match schema {
                Some(s) => format!(
                    "CREATE EXTENSION IF NOT EXISTS {} SCHEMA {}",
                    quote_ident(name),
                    quote_ident(s)
                ),
                None => format!("CREATE EXTENSION IF NOT EXISTS {}", quote_ident(name)),
            };
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn uninstall_extension(&self, name: &str) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let sql = format!("DROP EXTENSION IF EXISTS {} CASCADE", quote_ident(name));
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn list_available_extensions(&self) -> Result<Vec<AvailableExtensionInfo>, String> {
        let conn = self.get_meta().await?;
        self.timed(async {
            let rows = conn.query(
                "SELECT ae.name, ae.default_version, ae.comment, \
                        (SELECT true FROM pg_extension e WHERE e.extname = ae.name) IS NOT NULL AS installed \
                 FROM pg_available_extensions ae \
                 ORDER BY ae.name",
                &[],
            ).await.map_err(map_pg_err)?;
            Ok(rows.into_iter().map(|row| AvailableExtensionInfo {
                name: row.get(0),
                default_version: row.get::<_, String>(1),
                comment: row.get(2),
                installed: row.get(3),
            }).collect())
        }).await
    }

    async fn execute_script(&self, sql: &str) -> Result<Vec<super::ScriptStatementResult>, String> {
        self.execute_script_impl(sql).await
    }

    async fn create_table(&self, req: &super::CreateTableRequest) -> Result<(), String> {
        let ddl = Self::build_create_table_sql(req);
        let conn = self.get_conn().await?;
        conn.execute(&ddl as &str, &[]).await.map_err(map_pg_err)?;
        Ok(())
    }

    async fn explain_query(&self, sql: &str, analyze: bool) -> Result<serde_json::Value, String> {
        let trimmed = sql.trim();
        if trimmed.is_empty() {
            return Err("Kein SQL für EXPLAIN angegeben.".to_string());
        }
        if trimmed.trim_end_matches(';').trim().is_empty() {
            return Err("Kein SQL für EXPLAIN angegeben.".to_string());
        }
        let options = if analyze {
            "ANALYZE, BUFFERS, FORMAT JSON"
        } else {
            "FORMAT JSON"
        };
        let statement = format!("EXPLAIN ({options}) {trimmed}");
        let conn = self.get_meta().await?;
        self.timed(async {
            let row = conn
                .query_one(statement.as_str(), &[])
                .await
                .map_err(map_pg_err)?;
            Ok(row.get::<_, serde_json::Value>(0))
        })
        .await
    }

    async fn list_materialized_views(
        &self,
        schema: Option<&str>,
    ) -> Result<Vec<super::MatviewInfo>, String> {
        let conn = self.get_meta().await?;
        self.timed(async {
            let rows = match schema {
                Some(schema) => {
                    conn.query(
                        "SELECT schemaname, matviewname, ispopulated, definition \
                         FROM pg_matviews WHERE schemaname = $1 ORDER BY matviewname",
                        &[&schema],
                    )
                    .await
                }
                None => {
                    conn.query(
                        "SELECT schemaname, matviewname, ispopulated, definition \
                         FROM pg_matviews \
                         WHERE schemaname NOT IN ('pg_catalog', 'information_schema') \
                         ORDER BY schemaname, matviewname",
                        &[],
                    )
                    .await
                }
            };
            rows.map_err(map_pg_err).map(|rows| {
                rows.into_iter()
                    .map(|row| super::MatviewInfo {
                        schema: row.get(0),
                        name: row.get(1),
                        is_populated: row.get(2),
                        definition: row.get(3),
                    })
                    .collect()
            })
        })
        .await
    }

    async fn refresh_materialized_view(
        &self,
        schema: &str,
        name: &str,
        concurrently: bool,
    ) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let modifier = if concurrently { " CONCURRENTLY" } else { "" };
            let sql = format!(
                "REFRESH MATERIALIZED VIEW{} {}.{}",
                modifier,
                quote_ident(schema),
                quote_ident(name),
            );
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn drop_materialized_view(&self, schema: &str, name: &str) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let sql = format!(
                "DROP MATERIALIZED VIEW {}.{}",
                quote_ident(schema),
                quote_ident(name),
            );
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn create_materialized_view(
        &self,
        req: &super::CreateMatviewRequest,
    ) -> Result<(), String> {
        let query = req.query.trim();
        if query.is_empty() {
            return Err("Die SELECT-Abfrage darf nicht leer sein.".to_string());
        }
        if query.contains(';') {
            return Err("Nur eine einzelne SELECT-Abfrage ist erlaubt.".to_string());
        }
        let conn = self.get_conn().await?;
        self.timed(async {
            let data = if req.with_data {
                "WITH DATA"
            } else {
                "WITH NO DATA"
            };
            let sql = format!(
                "CREATE MATERIALIZED VIEW {}.{} AS {} {}",
                quote_ident(&req.schema),
                quote_ident(&req.name),
                query,
                data,
            );
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn get_table_rls(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<super::TableRlsInfo, String> {
        let conn = self.get_meta().await?;
        self.timed(async {
            let flags: (bool, bool) = conn
                .query_one(
                    "SELECT c.relrowsecurity, c.relforcerowsecurity \
                     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
                     WHERE n.nspname = $1 AND c.relname = $2",
                    &[&schema, &table],
                )
                .await
                .map_err(|_| format!("Tabelle {schema}.{table} nicht gefunden."))
                .map(|row| (row.get(0), row.get(1)))?;
            let policy_rows = conn
                .query(
                    "SELECT p.polname, p.polcmd, p.polroles, \
                            pg_get_expr(p.polqual, p.polrelid), pg_get_expr(p.polwithcheck, p.polrelid) \
                     FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid \
                     JOIN pg_namespace n ON n.oid = c.relnamespace \
                     WHERE n.nspname = $1 AND c.relname = $2 ORDER BY p.polname",
                    &[&schema, &table],
                )
                .await
                .map_err(map_pg_err)?;
            let mut role_oids: Vec<u32> = Vec::new();
            for row in &policy_rows {
                let oids: Vec<u32> = row.get(2);
                role_oids.extend(oids.iter().filter(|oid| **oid != 0));
            }
            role_oids.sort_unstable();
            role_oids.dedup();
            let role_names: std::collections::HashMap<u32, String> = if role_oids.is_empty() {
                std::collections::HashMap::new()
            } else {
                conn.query(
                    "SELECT oid, rolname FROM pg_authid WHERE oid = ANY($1)",
                    &[&role_oids],
                )
                .await
                .map_err(map_pg_err)?
                .iter()
                .map(|row| (row.get::<_, u32>(0), row.get::<_, String>(1)))
                .collect()
            };
            let policies = policy_rows
                .iter()
                .map(|row| {
                    let cmd: i8 = row.get(1);
                    let command = match cmd as u8 as char {
                        'r' => "SELECT",
                        'a' => "INSERT",
                        'w' => "UPDATE",
                        'd' => "DELETE",
                        _ => "ALL",
                    }
                    .to_string();
                    let oids: Vec<u32> = row.get(2);
                    let mut roles: Vec<String> = oids
                        .iter()
                        .map(|oid| {
                            if *oid == 0 {
                                "PUBLIC".to_string()
                            } else {
                                role_names.get(oid).cloned().unwrap_or_else(|| format!("oid:{oid}"))
                            }
                        })
                        .collect();
                    roles.sort();
                    super::PolicyInfo {
                        name: row.get(0),
                        command,
                        roles,
                        using_expr: row.get(3),
                        check_expr: row.get(4),
                    }
                })
                .collect();
            Ok(super::TableRlsInfo {
                rls_enabled: flags.0,
                force_rls: flags.1,
                policies,
            })
        })
        .await
    }

    async fn set_table_rls(
        &self,
        schema: &str,
        table: &str,
        enabled: bool,
        force: bool,
    ) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let target = format!("{}.{}", quote_ident(schema), quote_ident(table));
            let mode = if enabled { "ENABLE" } else { "DISABLE" };
            let force_mode = if force { "FORCE" } else { "NO FORCE" };
            conn.execute(
                format!("ALTER TABLE {target} {mode} ROW LEVEL SECURITY").as_str(),
                &[],
            )
            .await
            .map_err(map_pg_err)?;
            conn.execute(
                format!("ALTER TABLE {target} {force_mode} ROW LEVEL SECURITY").as_str(),
                &[],
            )
            .await
            .map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn create_policy(
        &self,
        schema: &str,
        table: &str,
        policy: &super::CreatePolicyRequest,
    ) -> Result<(), String> {
        let name = policy.name.trim();
        if name.is_empty() {
            return Err("Der Policy-Name darf nicht leer sein.".to_string());
        }
        let command = policy.command.trim().to_uppercase();
        if !["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"].contains(&command.as_str()) {
            return Err(format!("Ungültiger Policy-Befehl: {}", policy.command));
        }
        for role in &policy.roles {
            if role == "PUBLIC" || role == "CURRENT_USER" || role == "SESSION_USER" {
                continue;
            }
            let valid = !role.is_empty()
                && role
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_alphabetic() || c == '_')
                && role
                    .chars()
                    .all(|c| c.is_alphanumeric() || c == '_' || c == '$');
            if !valid {
                return Err(format!("Ungültiger Rollenname: {role}"));
            }
        }
        let conn = self.get_conn().await?;
        self.timed(async {
            let to = if policy.roles.is_empty() {
                "PUBLIC".to_string()
            } else {
                policy
                    .roles
                    .iter()
                    .map(|r| {
                        if r == "PUBLIC" || r == "CURRENT_USER" || r == "SESSION_USER" {
                            r.clone()
                        } else {
                            quote_ident(r)
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(", ")
            };
            let mut sql = format!(
                "CREATE POLICY {} ON {}.{} FOR {} TO {}",
                quote_ident(name),
                quote_ident(schema),
                quote_ident(table),
                command,
                to,
            );
            if let Some(expr) = policy
                .using_expr
                .as_deref()
                .map(str::trim)
                .filter(|e| !e.is_empty())
            {
                sql.push_str(&format!(" USING ({expr})"));
            }
            if let Some(expr) = policy
                .check_expr
                .as_deref()
                .map(str::trim)
                .filter(|e| !e.is_empty())
            {
                sql.push_str(&format!(" WITH CHECK ({expr})"));
            }
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn drop_policy(&self, schema: &str, table: &str, name: &str) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let sql = format!(
                "DROP POLICY {} ON {}.{}",
                quote_ident(name),
                quote_ident(schema),
                quote_ident(table),
            );
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn get_partition_info(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<super::PartitionInfo, String> {
        let conn = self.get_meta().await?;
        self.timed(async {
            let row = conn
                .query_one(
                    "SELECT c.relkind, p.partstrat, pg_get_partkeydef(c.oid) \
                     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace \
                     LEFT JOIN pg_partitioned_table p ON p.partrelid = c.oid \
                     WHERE n.nspname = $1 AND c.relname = $2",
                    &[&schema, &table],
                )
                .await
                .map_err(|_| format!("Tabelle {schema}.{table} nicht gefunden."))?;
            let relkind: i8 = row.get(0);
            let is_partitioned = relkind as u8 as char == 'p';
            let strategy: Option<String> =
                row.get::<_, Option<i8>>(1).map(|s| match s as u8 as char {
                    'r' => "RANGE".to_string(),
                    'l' => "LIST".to_string(),
                    'h' => "HASH".to_string(),
                    other => other.to_string(),
                });
            let partition_key: Option<String> = row.get(2);
            let partitions = if is_partitioned {
                conn.query(
                    "SELECT n.nspname, c.relname FROM pg_inherits i \
                     JOIN pg_class c ON c.oid = i.inhrelid \
                     JOIN pg_namespace n ON n.oid = c.relnamespace \
                     WHERE i.inhparent = format('%I.%I', $1::text, $2::text)::regclass \
                     ORDER BY c.relname",
                    &[&schema, &table],
                )
                .await
                .map_err(map_pg_err)?
                .iter()
                .map(|row| super::PartitionChild {
                    schema: row.get(0),
                    name: row.get(1),
                })
                .collect()
            } else {
                Vec::new()
            };
            Ok(super::PartitionInfo {
                is_partitioned,
                strategy,
                partition_key,
                partitions,
            })
        })
        .await
    }

    async fn detach_partition(
        &self,
        parent_schema: &str,
        parent_table: &str,
        child_schema: &str,
        child_table: &str,
    ) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let sql = format!(
                "ALTER TABLE {}.{} DETACH PARTITION {}.{}",
                quote_ident(parent_schema),
                quote_ident(parent_table),
                quote_ident(child_schema),
                quote_ident(child_table),
            );
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn attach_partition(
        &self,
        parent_schema: &str,
        parent_table: &str,
        child_schema: &str,
        child_table: &str,
        bound: &str,
    ) -> Result<(), String> {
        let trimmed = bound.trim();
        if trimmed.len() < 10 || !trimmed[..10].eq_ignore_ascii_case("for values") {
            return Err("Die Partition-Bindung muss mit FOR VALUES beginnen.".to_string());
        }
        let lowered = trimmed.to_lowercase();
        for token in [";", "--", "/*", "*/"] {
            if lowered.contains(token) {
                return Err("Die Partition-Bindung enthält unzulässige Zeichen.".to_string());
            }
        }
        let conn = self.get_conn().await?;
        self.timed(async {
            let sql = format!(
                "ALTER TABLE {}.{} ATTACH PARTITION {}.{} {}",
                quote_ident(parent_schema),
                quote_ident(parent_table),
                quote_ident(child_schema),
                quote_ident(child_table),
                trimmed,
            );
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn list_publications(&self) -> Result<Vec<super::PublicationInfo>, String> {
        let conn = self.get_meta().await?;
        self.timed(async {
            let rows = conn
                .query(
                    "SELECT p.pubname, r.rolname, p.puballtables, p.pubinsert, p.pubupdate, p.pubdelete, p.pubtruncate \
                     FROM pg_publication p JOIN pg_roles r ON r.oid = p.pubowner \
                     ORDER BY p.pubname",
                    &[],
                )
                .await
                .map_err(map_pg_err)?;
            let mut publications = Vec::new();
            for row in &rows {
                let name: String = row.get(0);
                let tables: Vec<String> = conn
                    .query(
                        "SELECT schemaname || '.' || tablename FROM pg_publication_tables \
                         WHERE pubname = $1 ORDER BY 1",
                        &[&name],
                    )
                    .await
                    .map_err(map_pg_err)?
                    .iter()
                    .map(|table_row| table_row.get(0))
                    .collect();
                publications.push(super::PublicationInfo {
                    name,
                    owner: row.get(1),
                    all_tables: row.get(2),
                    insert: row.get(3),
                    update: row.get(4),
                    delete: row.get(5),
                    truncate: row.get(6),
                    tables,
                });
            }
            Ok(publications)
        })
        .await
    }

    async fn create_publication(
        &self,
        req: &super::CreatePublicationRequest,
    ) -> Result<(), String> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err("Der Publikations-Name darf nicht leer sein.".to_string());
        }
        if !req.for_all_tables && req.tables.is_empty() {
            return Err(
                "Entweder FOR ALL TABLES oder mindestens eine Tabelle angeben.".to_string(),
            );
        }
        let mut ops = Vec::new();
        if req.publish_insert {
            ops.push("insert");
        }
        if req.publish_update {
            ops.push("update");
        }
        if req.publish_delete {
            ops.push("delete");
        }
        if req.publish_truncate {
            ops.push("truncate");
        }
        if ops.is_empty() {
            return Err(
                "Mindestens eine Operation (insert/update/delete/truncate) wählen.".to_string(),
            );
        }
        let conn = self.get_conn().await?;
        self.timed(async {
            let target = if req.for_all_tables {
                "FOR ALL TABLES".to_string()
            } else {
                let tables = req
                    .tables
                    .iter()
                    .map(|t| format!("{}.{}", quote_ident(&t.schema), quote_ident(&t.table)))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!("FOR TABLE {tables}")
            };
            let sql = format!(
                "CREATE PUBLICATION {} {} WITH (publish = '{}')",
                quote_ident(name),
                target,
                ops.join(","),
            );
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn drop_publication(&self, name: &str) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let sql = format!("DROP PUBLICATION {}", quote_ident(name));
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn list_subscriptions(&self) -> Result<Vec<super::SubscriptionInfo>, String> {
        let conn = self.get_meta().await?;
        self.timed(async {
            conn.query(
                "SELECT subname, subenabled, subconninfo, subslotname, subpublications \
                 FROM pg_subscription ORDER BY subname",
                &[],
            )
            .await
            .map_err(map_pg_err)
            .map(|rows| {
                rows.into_iter()
                    .map(|row| {
                        let raw: String = row.get(2);
                        super::SubscriptionInfo {
                            name: row.get(0),
                            enabled: row.get(1),
                            connection_string: redact_connection_string(&raw),
                            slot_name: row.get(3),
                            publications: row.get(4),
                        }
                    })
                    .collect()
            })
        })
        .await
    }

    async fn create_subscription(
        &self,
        req: &super::CreateSubscriptionRequest,
    ) -> Result<(), String> {
        let name = req.name.trim();
        if name.is_empty() {
            return Err("Der Subskriptions-Name darf nicht leer sein.".to_string());
        }
        if req.publications.is_empty() {
            return Err("Mindestens eine Publikation angeben.".to_string());
        }
        if req.connection_string.trim().is_empty() {
            return Err("Der Connection-String darf nicht leer sein.".to_string());
        }
        let escaped = req
            .connection_string
            .replace('\\', "\\\\")
            .replace('\'', "\\'");
        let conn = self.get_conn().await?;
        self.timed(async {
            let publications = req
                .publications
                .iter()
                .map(|p| quote_ident(p))
                .collect::<Vec<_>>()
                .join(", ");
            let mut options = vec![format!(
                "enabled = {}",
                if req.enabled { "true" } else { "false" }
            )];
            options.push(format!(
                "connect = {}",
                if req.connect { "true" } else { "false" }
            ));
            if let Some(slot) = req
                .slot_name
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
            {
                options.push(format!("slot_name = {}", quote_literal(slot)));
            }
            let sql = format!(
                "CREATE SUBSCRIPTION {} CONNECTION '{}' PUBLICATION {} WITH ({})",
                quote_ident(name),
                escaped,
                publications,
                options.join(", "),
            );
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn drop_subscription(&self, name: &str) -> Result<(), String> {
        let conn = self.get_conn().await?;
        self.timed(async {
            let sql = format!("DROP SUBSCRIPTION {}", quote_ident(name));
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn list_sessions(&self) -> Result<Vec<super::SessionInfo>, String> {
        let conn = self.get_meta().await?;
        self.timed(async {
            conn.query(
                "SELECT pid, usename, datname, COALESCE(application_name, ''), client_addr::text, \
                        state, COALESCE(left(query, 500), ''), query_start::text, xact_start::text, \
                        wait_event, pid = pg_backend_pid() \
                 FROM pg_stat_activity WHERE datname IS NOT NULL \
                 ORDER BY query_start NULLS LAST",
                &[],
            )
            .await
            .map_err(map_pg_err)
            .map(|rows| {
                rows.into_iter()
                    .map(|row| super::SessionInfo {
                        pid: row.get(0),
                        user: row.get(1),
                        database: row.get(2),
                        application: row.get(3),
                        client_addr: row.get(4),
                        state: row.get(5),
                        query: row.get(6),
                        query_start: row.get(7),
                        transaction_start: row.get(8),
                        wait_event: row.get(9),
                        is_self: row.get(10),
                    })
                    .collect()
            })
        })
        .await
    }

    async fn cancel_session(&self, pid: i32) -> Result<bool, String> {
        if pid <= 0 {
            return Err("Ungültige Prozess-ID.".to_string());
        }
        let conn = self.get_meta().await?;
        self.timed(async {
            conn.query_one("SELECT pg_cancel_backend($1)", &[&pid])
                .await
                .map_err(map_pg_err)
                .map(|row| row.get(0))
        })
        .await
    }

    async fn terminate_session(&self, pid: i32) -> Result<bool, String> {
        if pid <= 0 {
            return Err("Ungültige Prozess-ID.".to_string());
        }
        let conn = self.get_meta().await?;
        let own: i32 = conn
            .query_one("SELECT pg_backend_pid()", &[])
            .await
            .map_err(map_pg_err)
            .map(|row| row.get(0))?;
        if own == pid {
            return Err("Die eigene Sitzung kann nicht beendet werden.".to_string());
        }
        self.timed(async {
            conn.query_one("SELECT pg_terminate_backend($1)", &[&pid])
                .await
                .map_err(map_pg_err)
                .map(|row| row.get(0))
        })
        .await
    }

    async fn list_locks(&self) -> Result<Vec<super::LockInfo>, String> {
        let conn = self.get_meta().await?;
        self.timed(async {
            conn.query(
                "SELECT l.pid, l.locktype, \
                        CASE WHEN l.relation IS NOT NULL THEN n.nspname || '.' || c.relname ELSE NULL END, \
                        l.mode, l.granted \
                 FROM pg_locks l \
                 LEFT JOIN pg_class c ON c.oid = l.relation \
                 LEFT JOIN pg_namespace n ON n.oid = c.relnamespace \
                 ORDER BY l.pid, l.granted DESC",
                &[],
            )
            .await
            .map_err(map_pg_err)
            .map(|rows| {
                rows.into_iter()
                    .map(|row| super::LockInfo {
                        pid: row.get(0),
                        lock_type: row.get(1),
                        relation: row.get(2),
                        mode: row.get(3),
                        granted: row.get(4),
                    })
                    .collect()
            })
        })
        .await
    }

    async fn list_enums(&self, schema: Option<&str>) -> Result<Vec<super::EnumInfo>, String> {
        let conn = self.get_meta().await?;
        self.timed(async {
            let rows = match schema {
                Some(schema) => {
                    conn.query(
                        "SELECT n.nspname, t.typname, e.enumlabel::text \
                         FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace \
                         JOIN pg_enum e ON e.enumtypid = t.oid \
                         WHERE n.nspname = $1 ORDER BY t.typname, e.enumsortorder",
                        &[&schema],
                    )
                    .await
                }
                None => {
                    conn.query(
                        "SELECT n.nspname, t.typname, e.enumlabel::text \
                         FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace \
                         JOIN pg_enum e ON e.enumtypid = t.oid \
                         WHERE n.nspname NOT IN ('pg_catalog', 'information_schema') \
                           AND n.nspname NOT LIKE 'pg\\_temp\\_%' \
                         ORDER BY n.nspname, t.typname, e.enumsortorder",
                        &[],
                    )
                    .await
                }
            };
            rows.map_err(map_pg_err).map(|rows| {
                let mut enums: Vec<super::EnumInfo> = Vec::new();
                for row in &rows {
                    let schema: String = row.get(0);
                    let name: String = row.get(1);
                    let value: String = row.get(2);
                    match enums
                        .iter_mut()
                        .find(|e| e.schema == schema && e.name == name)
                    {
                        Some(entry) => entry.values.push(value),
                        None => enums.push(super::EnumInfo {
                            schema,
                            name,
                            values: vec![value],
                        }),
                    }
                }
                enums
            })
        })
        .await
    }

    async fn create_schema(&self, name: &str) -> Result<(), String> {
        let name = name.trim();
        if name.is_empty() {
            return Err("Der Schema-Name darf nicht leer sein.".to_string());
        }
        let conn = self.get_conn().await?;
        self.timed(async {
            let sql = format!("CREATE SCHEMA {}", quote_ident(name));
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn drop_schema(&self, name: &str, cascade: bool) -> Result<(), String> {
        let lowered = name.trim().to_lowercase();
        if ["pg_catalog", "information_schema", "public", "pg_toast"].contains(&lowered.as_str()) {
            return Err(format!("Das Schema {name} darf nicht gelöscht werden."));
        }
        let conn = self.get_conn().await?;
        self.timed(async {
            let suffix = if cascade { " CASCADE" } else { "" };
            let sql = format!("DROP SCHEMA {}{suffix}", quote_ident(name));
            conn.execute(sql.as_str(), &[]).await.map_err(map_pg_err)?;
            Ok(())
        })
        .await
    }

    async fn get_database_overview(&self) -> Result<super::DatabaseOverview, String> {
        let conn = self.get_meta().await?;
        self.timed(async {
            let row = conn
                .query_one(
                    "SELECT current_database(), pg_database_size(current_database()), \
                            pg_size_pretty(pg_database_size(current_database()))",
                    &[],
                )
                .await
                .map_err(map_pg_err)?;
            let schemas: Vec<super::SchemaSize> = conn
                .query(
                    "SELECT n.nspname, COUNT(c.oid), COALESCE(SUM(pg_relation_size(c.oid)), 0)::bigint \
                     FROM pg_namespace n \
                     LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relkind IN ('r', 'm', 'p') \
                     WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_toast') \
                       AND n.nspname NOT LIKE 'pg\\_temp\\_%' \
                     GROUP BY n.nspname ORDER BY 3 DESC",
                    &[],
                )
                .await
                .map_err(map_pg_err)?
                .iter()
                .map(|row| super::SchemaSize {
                    schema: row.get(0),
                    table_count: row.get(1),
                    size_bytes: row.get(2),
                })
                .collect();
            Ok(super::DatabaseOverview {
                database: row.get(0),
                size_bytes: row.get(1),
                size_pretty: row.get(2),
                schemas,
            })
        })
        .await
    }
}

impl PostgresAdapter {
    async fn list_indexes_impl(&self, schema: &str, table: &str) -> Result<Vec<IndexInfo>, String> {
        let conn = self.get_meta().await?;
        self.timed(async {
            let rows = conn.query(
                "SELECT i.relname, ix.indisunique, ix.indisprimary, a.attname, am.amname, pg_get_indexdef(i.oid) \
                 FROM pg_class c \
                 JOIN pg_namespace n ON n.oid = c.relnamespace \
                 JOIN pg_index ix ON ix.indrelid = c.oid \
                 JOIN pg_class i ON i.oid = ix.indexrelid \
                 JOIN pg_am am ON am.oid = i.relam \
                 CROSS JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ordinality) \
                 JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum AND a.attnum > 0 \
                 WHERE n.nspname = $1 AND c.relname = $2 \
                 ORDER BY ix.indisprimary DESC, ix.indisunique DESC, i.relname, k.ordinality",
                &[&schema, &table],
            ).await.map_err(map_pg_err)?;

            let mut indexes: Vec<IndexInfo> = Vec::new();
            for row in &rows {
                let name: String = row.get(0);
                let col: String = row.get(3);
                if let Some(idx) = indexes.iter_mut().find(|i| i.name == name) {
                    idx.columns.push(col);
                } else {
                    indexes.push(IndexInfo {
                        name,
                        is_unique: row.get(1),
                        is_primary: row.get(2),
                        columns: vec![col],
                        index_type: row.get(4),
                        definition: row.get(5),
                    });
                }
            }
            Ok(indexes)
        }).await
    }

    async fn list_constraints_impl(
        &self,
        schema: &str,
        table: &str,
    ) -> Result<Vec<ConstraintInfo>, String> {
        let conn = self.get_meta().await?;
        self.timed(async {
            let rows = conn.query(
                "SELECT con.conname, \
                        CASE con.contype \
                            WHEN 'p' THEN 'PRIMARY KEY' \
                            WHEN 'u' THEN 'UNIQUE' \
                            WHEN 'f' THEN 'FOREIGN KEY' \
                            WHEN 'c' THEN 'CHECK' \
                            WHEN 'x' THEN 'EXCLUDE' \
                            ELSE con.contype::text \
                        END, \
                        COALESCE(a.attname, ''), \
                        pg_get_constraintdef(con.oid) \
                 FROM pg_constraint con \
                 JOIN pg_class c ON c.oid = con.conrelid \
                 JOIN pg_namespace n ON n.oid = c.relnamespace \
                 LEFT JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(attnum, ordinality) ON true \
                 LEFT JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum \
                 WHERE n.nspname = $1 AND c.relname = $2 \
                 ORDER BY con.contype, con.conname, k.ordinality",
                &[&schema, &table],
            ).await.map_err(map_pg_err)?;

            let mut constraints: Vec<ConstraintInfo> = Vec::new();
            for row in &rows {
                let name: String = row.get(0);
                let col: String = row.get(2);
                if let Some(con) = constraints.iter_mut().find(|c| c.name == name) {
                    if !col.is_empty() && !con.columns.contains(&col) {
                        con.columns.push(col);
                    }
                } else {
                    constraints.push(ConstraintInfo {
                        name,
                        constraint_type: row.get(1),
                        columns: if col.is_empty() { vec![] } else { vec![col] },
                        definition: row.get(3),
                    });
                }
            }
            Ok(constraints)
        }).await
    }

    async fn execute_script_impl(
        &self,
        sql: &str,
    ) -> Result<Vec<super::ScriptStatementResult>, String> {
        use super::ScriptStatementResult;
        let statements: Vec<&str> = sql
            .split(';')
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .collect();

        let conn = self.get_conn().await?;
        let mut results = Vec::new();
        for stmt in statements {
            let full = format!("{};", stmt);
            match conn.execute(stmt, &[]).await {
                Ok(n) => results.push(ScriptStatementResult {
                    statement: full,
                    success: true,
                    rows_affected: Some(n),
                    error: None,
                }),
                Err(e) => results.push(ScriptStatementResult {
                    statement: full,
                    success: false,
                    rows_affected: None,
                    error: Some(map_pg_err(e)),
                }),
            }
        }
        Ok(results)
    }

    fn build_create_table_sql(req: &super::CreateTableRequest) -> String {
        let mut parts: Vec<String> = Vec::new();
        let mut pk_cols: Vec<String> = Vec::new();

        for col in &req.columns {
            let mut def = format!("{} {}", quote_ident(&col.name), col.data_type);
            if !col.is_nullable {
                def.push_str(" NOT NULL");
            }
            if let Some(d) = &col.default_value {
                if !d.is_empty() {
                    def.push_str(&format!(" DEFAULT {d}"));
                }
            }
            if col.is_unique && !col.is_primary_key {
                def.push_str(" UNIQUE");
            }
            parts.push(def);
            if col.is_primary_key {
                pk_cols.push(quote_ident(&col.name));
            }
        }

        if !pk_cols.is_empty() {
            parts.push(format!("PRIMARY KEY ({})", pk_cols.join(", ")));
        }

        let if_not_exists = if req.if_not_exists {
            "IF NOT EXISTS "
        } else {
            ""
        };
        format!(
            "CREATE TABLE {}{}.{} (\n  {}\n)",
            if_not_exists,
            quote_ident(&req.schema),
            quote_ident(&req.name),
            parts.join(",\n  "),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::PostgresAdapter;
    use crate::db::{pool::create_pool_state, DatabaseAdapter};

    fn lab_connection_string() -> String {
        std::env::var("L8DB_E2E_PG_URL")
            .unwrap_or_else(|_| "postgresql://postgres:testpw@127.0.0.1:5433/testdb".to_string())
    }

    fn lab_adapter() -> PostgresAdapter {
        PostgresAdapter::from_connection_string(&lab_connection_string(), None, create_pool_state())
            .expect("adapter")
    }

    async fn lab_execute(adapter: &PostgresAdapter, sql: &str) {
        eprintln!("e2e-exec: {sql}");
        adapter.execute_query(sql).await.expect(sql);
    }

    async fn lab_cleanup_subscription(adapter: &PostgresAdapter, sub_db: &str, sub: &str) {
        let _ = adapter
            .execute_query(
                "SELECT pg_terminate_backend(active_pid) FROM pg_replication_slots WHERE active_pid IS NOT NULL",
            )
            .await;
        let _ = adapter
            .execute_query(&format!(
                "SELECT pg_drop_replication_slot('{sub}') WHERE EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = '{sub}' AND NOT active)"
            ))
            .await;
        let _ = adapter
            .execute_query(&format!(
                "SELECT pg_create_logical_replication_slot('{sub}', 'pgoutput') WHERE NOT EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = '{sub}')"
            ))
            .await;
        if let Ok(stale) = PostgresAdapter::from_connection_string(
            &lab_connection_string(),
            Some(sub_db),
            create_pool_state(),
        ) {
            let _ = stale.drop_subscription(sub).await;
        }
        let _ = adapter
            .execute_query(&format!(
                "SELECT pg_drop_replication_slot('{sub}') WHERE EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = '{sub}' AND NOT active)"
            ))
            .await;
    }

    #[tokio::test]
    #[ignore]
    async fn connection_test_rejects_changed_password() {
        let state = create_pool_state();
        let value = lab_connection_string();
        let valid = PostgresAdapter::from_connection_string(&value, None, state.clone()).unwrap();
        valid.list_schemas().await.expect("warm metadata pool");
        valid.test_connection().await.expect("valid credentials");
        let mut wrong = url::Url::parse(&value).unwrap();
        wrong
            .set_password(Some("l8db-intentionally-invalid-password"))
            .unwrap();
        let invalid = PostgresAdapter::from_connection_string(wrong.as_str(), None, state).unwrap();
        assert!(invalid.test_connection().await.is_err());
        assert_ne!(valid.pool_key, invalid.pool_key);
    }

    #[tokio::test]
    #[ignore]
    async fn explain_returns_json_plan() {
        let adapter = PostgresAdapter::from_connection_string(
            &lab_connection_string(),
            None,
            create_pool_state(),
        )
        .expect("adapter");
        let plan = adapter
            .explain_query("SELECT 1 AS one", false)
            .await
            .expect("explain");
        let first = plan
            .as_array()
            .and_then(|items| items.first())
            .expect("plan array");
        assert!(first.get("Plan").is_some(), "{plan}");
    }

    #[tokio::test]
    #[ignore]
    async fn explain_analyze_reports_actual_rows() {
        let adapter = PostgresAdapter::from_connection_string(
            &lab_connection_string(),
            None,
            create_pool_state(),
        )
        .expect("adapter");
        let plan = adapter
            .explain_query("SELECT generate_series(1, 10) AS n", true)
            .await
            .expect("explain analyze");
        let node = plan
            .as_array()
            .and_then(|items| items.first())
            .and_then(|item| item.get("Plan"))
            .expect("plan node");
        assert_eq!(
            node.get("Actual Rows").and_then(|v| v.as_f64()),
            Some(10.0),
            "{node}"
        );
    }

    #[tokio::test]
    #[ignore]
    async fn matview_lifecycle() {
        use crate::db::CreateMatviewRequest;
        let adapter = lab_adapter();
        lab_execute(&adapter, "DROP MATERIALIZED VIEW IF EXISTS public.e2e_mv").await;
        adapter
            .create_materialized_view(&CreateMatviewRequest {
                schema: "public".to_string(),
                name: "e2e_mv".to_string(),
                query: "SELECT generate_series(1, 5) AS n".to_string(),
                with_data: true,
            })
            .await
            .expect("create");
        let views = adapter
            .list_materialized_views(Some("public"))
            .await
            .expect("list");
        let found = views.iter().find(|v| v.name == "e2e_mv").expect("found");
        assert!(found.is_populated);
        adapter
            .refresh_materialized_view("public", "e2e_mv", false)
            .await
            .expect("refresh");
        adapter
            .drop_materialized_view("public", "e2e_mv")
            .await
            .expect("drop");
        let views = adapter
            .list_materialized_views(Some("public"))
            .await
            .expect("list");
        assert!(views.iter().all(|v| v.name != "e2e_mv"));
    }

    #[tokio::test]
    #[ignore]
    async fn rls_lifecycle() {
        use crate::db::CreatePolicyRequest;
        let adapter = lab_adapter();
        lab_execute(&adapter, "DROP TABLE IF EXISTS public.e2e_rls").await;
        lab_execute(&adapter, "CREATE TABLE public.e2e_rls (id int, owner text)").await;
        lab_execute(&adapter, "DROP POLICY IF EXISTS e2e_pol ON public.e2e_rls").await;
        let info = adapter
            .get_table_rls("public", "e2e_rls")
            .await
            .expect("info");
        assert!(!info.rls_enabled);
        assert!(info.policies.is_empty());
        adapter
            .set_table_rls("public", "e2e_rls", true, false)
            .await
            .expect("enable");
        adapter
            .create_policy(
                "public",
                "e2e_rls",
                &CreatePolicyRequest {
                    name: "e2e_pol".to_string(),
                    command: "SELECT".to_string(),
                    roles: vec!["PUBLIC".to_string()],
                    using_expr: Some("true".to_string()),
                    check_expr: None,
                },
            )
            .await
            .expect("create policy");
        let info = adapter
            .get_table_rls("public", "e2e_rls")
            .await
            .expect("info");
        assert!(info.rls_enabled);
        assert_eq!(info.policies.len(), 1);
        assert_eq!(info.policies[0].command, "SELECT");
        assert_eq!(info.policies[0].roles, vec!["PUBLIC".to_string()]);
        adapter
            .drop_policy("public", "e2e_rls", "e2e_pol")
            .await
            .expect("drop policy");
        adapter
            .set_table_rls("public", "e2e_rls", false, false)
            .await
            .expect("disable");
        lab_execute(&adapter, "DROP TABLE public.e2e_rls").await;
    }

    #[tokio::test]
    #[ignore]
    async fn partition_detach_attach() {
        let adapter = lab_adapter();
        lab_execute(&adapter, "DROP TABLE IF EXISTS public.e2e_part").await;
        lab_execute(
            &adapter,
            "CREATE TABLE public.e2e_part (id int, created date NOT NULL) PARTITION BY RANGE (created)",
        )
        .await;
        lab_execute(
            &adapter,
            "CREATE TABLE public.e2e_part_2024 PARTITION OF public.e2e_part FOR VALUES FROM ('2024-01-01') TO ('2025-01-01')",
        )
        .await;
        let info = adapter
            .get_partition_info("public", "e2e_part")
            .await
            .expect("info");
        assert!(info.is_partitioned);
        assert_eq!(info.strategy.as_deref(), Some("RANGE"));
        assert_eq!(info.partitions.len(), 1);
        adapter
            .detach_partition("public", "e2e_part", "public", "e2e_part_2024")
            .await
            .expect("detach");
        let info = adapter
            .get_partition_info("public", "e2e_part")
            .await
            .expect("info");
        assert!(info.partitions.is_empty());
        adapter
            .attach_partition(
                "public",
                "e2e_part",
                "public",
                "e2e_part_2024",
                "FOR VALUES FROM ('2024-01-01') TO ('2025-01-01')",
            )
            .await
            .expect("attach");
        let info = adapter
            .get_partition_info("public", "e2e_part")
            .await
            .expect("info");
        assert_eq!(info.partitions.len(), 1);
        let plain = adapter
            .get_partition_info("public", "e2e_part_2024")
            .await
            .expect("plain");
        assert!(!plain.is_partitioned);
        lab_execute(&adapter, "DROP TABLE public.e2e_part_2024").await;
        lab_execute(&adapter, "DROP TABLE public.e2e_part").await;
    }

    #[tokio::test]
    #[ignore]
    async fn publication_lifecycle() {
        use crate::db::{CreatePublicationRequest, PublicationTable};
        let adapter = lab_adapter();
        lab_execute(&adapter, "DROP PUBLICATION IF EXISTS e2e_pub").await;
        lab_execute(&adapter, "DROP TABLE IF EXISTS public.e2e_pub_t").await;
        lab_execute(
            &adapter,
            "CREATE TABLE public.e2e_pub_t (id int primary key, v text)",
        )
        .await;
        adapter
            .create_publication(&CreatePublicationRequest {
                name: "e2e_pub".to_string(),
                for_all_tables: false,
                tables: vec![PublicationTable {
                    schema: "public".to_string(),
                    table: "e2e_pub_t".to_string(),
                }],
                publish_insert: true,
                publish_update: true,
                publish_delete: false,
                publish_truncate: false,
            })
            .await
            .expect("create");
        let pubs = adapter.list_publications().await.expect("list");
        let found = pubs.iter().find(|p| p.name == "e2e_pub").expect("found");
        assert!(!found.all_tables);
        assert!(found.insert && found.update);
        assert!(!found.delete && !found.truncate);
        assert_eq!(found.tables, vec!["public.e2e_pub_t".to_string()]);
        adapter.drop_publication("e2e_pub").await.expect("drop");
        lab_execute(&adapter, "DROP TABLE public.e2e_pub_t").await;
    }

    #[tokio::test]
    #[ignore]
    async fn subscription_crud_disabled() {
        use crate::db::{CreatePublicationRequest, CreateSubscriptionRequest, PublicationTable};
        let adapter = lab_adapter();
        lab_cleanup_subscription(&adapter, "testsub", "e2e_sub").await;
        lab_execute(&adapter, "DROP PUBLICATION IF EXISTS e2e_pub2").await;
        lab_execute(&adapter, "DROP TABLE IF EXISTS public.e2e_pub_t2").await;
        lab_execute(
            &adapter,
            "CREATE TABLE public.e2e_pub_t2 (id int primary key, v text)",
        )
        .await;
        adapter
            .create_publication(&CreatePublicationRequest {
                name: "e2e_pub2".to_string(),
                for_all_tables: false,
                tables: vec![PublicationTable {
                    schema: "public".to_string(),
                    table: "e2e_pub_t2".to_string(),
                }],
                publish_insert: true,
                publish_update: true,
                publish_delete: true,
                publish_truncate: true,
            })
            .await
            .expect("create pub");
        lab_execute(
            &adapter,
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'testsub'",
        )
        .await;
        lab_cleanup_subscription(&adapter, "testsub", "e2e_sub").await;
        lab_execute(
            &adapter,
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'testsub'",
        )
        .await;
        lab_execute(&adapter, "DROP DATABASE IF EXISTS testsub").await;
        lab_execute(&adapter, "CREATE DATABASE testsub").await;
        let sub_adapter = PostgresAdapter::from_connection_string(
            &lab_connection_string(),
            Some("testsub"),
            create_pool_state(),
        )
        .expect("sub adapter");
        lab_execute(
            &sub_adapter,
            "CREATE TABLE public.e2e_pub_t2 (id int primary key, v text)",
        )
        .await;
        sub_adapter
            .create_subscription(&CreateSubscriptionRequest {
                name: "e2e_sub".to_string(),
                connection_string: "host=l8db-pg port=5432 dbname=testdb user=postgres password=testpw".to_string(),
                publications: vec!["e2e_pub2".to_string()],
                slot_name: None,
                enabled: false,
                connect: false,
            })
            .await
            .expect("create sub");
        let subs = sub_adapter.list_subscriptions().await.expect("list");
        let found = subs.iter().find(|s| s.name == "e2e_sub").expect("found");
        assert!(!found.enabled);
        assert_eq!(found.publications, vec!["e2e_pub2".to_string()]);
        assert!(!found.connection_string.contains("testpw"));
        lab_execute(
            &adapter,
            "SELECT pg_create_logical_replication_slot('e2e_sub', 'pgoutput')",
        )
        .await;
        sub_adapter
            .drop_subscription("e2e_sub")
            .await
            .expect("drop sub");
        lab_execute(&adapter, "SELECT pg_drop_replication_slot('e2e_sub') WHERE EXISTS (SELECT 1 FROM pg_replication_slots WHERE slot_name = 'e2e_sub' AND NOT active)").await;
        lab_execute(&adapter, "DROP PUBLICATION e2e_pub2").await;
        lab_execute(&adapter, "DROP TABLE public.e2e_pub_t2").await;
        lab_execute(
            &adapter,
            "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'testsub'",
        )
        .await;
        lab_execute(&adapter, "DROP DATABASE testsub").await;
    }

    #[tokio::test]
    #[ignore]
    async fn sessions_and_locks() {
        let adapter = lab_adapter();
        let sessions = adapter.list_sessions().await.expect("sessions");
        assert!(sessions.iter().any(|s| s.is_self));
        assert!(adapter.cancel_session(-1).await.is_err());
        assert!(adapter.terminate_session(-1).await.is_err());
        let (client, connection) = tokio_postgres::Config::new()
            .host("127.0.0.1")
            .port(5433)
            .user("postgres")
            .password("testpw")
            .dbname("testdb")
            .connect(tokio_postgres::NoTls)
            .await
            .expect("spawn conn");
        tokio::spawn(async move {
            let _ = connection.await;
        });
        let pid: i32 = client
            .query_one("SELECT pg_backend_pid()", &[])
            .await
            .expect("pid")
            .get(0);
        let sleep =
            tokio::spawn(async move { client.query("SELECT pg_sleep(60)", &[]).await.map(|_| ()) });
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        assert!(adapter.cancel_session(pid).await.expect("cancel sleep"));
        let outcome = sleep.await.expect("join");
        assert!(outcome.is_err(), "sleep should have been cancelled");
        let locks = adapter.list_locks().await.expect("locks");
        assert!(!locks.is_empty());
    }

    #[tokio::test]
    #[ignore]
    async fn terminate_idle_backend() {
        let (client, connection) = tokio_postgres::Config::new()
            .host("127.0.0.1")
            .port(5433)
            .user("postgres")
            .password("testpw")
            .dbname("testdb")
            .connect(tokio_postgres::NoTls)
            .await
            .expect("spawn conn");
        tokio::spawn(async move {
            let _ = connection.await;
        });
        let pid: i32 = client
            .query_one("SELECT pg_backend_pid()", &[])
            .await
            .expect("pid")
            .get(0);
        let adapter = lab_adapter();
        assert!(adapter.terminate_session(pid).await.expect("terminate"));
        assert!(
            adapter.terminate_session(pid).await.is_err()
                || adapter.terminate_session(pid).await.expect("retry") == false
        );
    }

    #[tokio::test]
    #[ignore]
    async fn enum_and_schema_lifecycle() {
        let adapter = lab_adapter();
        lab_execute(&adapter, "DROP TYPE IF EXISTS public.e2e_mood").await;
        lab_execute(&adapter, "DROP SCHEMA IF EXISTS e2e_schema CASCADE").await;
        lab_execute(
            &adapter,
            "CREATE TYPE public.e2e_mood AS ENUM ('gut', 'ok', 'schlecht')",
        )
        .await;
        let enums = adapter.list_enums(Some("public")).await.expect("enums");
        let found = enums.iter().find(|e| e.name == "e2e_mood").expect("found");
        assert_eq!(
            found.values,
            vec!["gut".to_string(), "ok".to_string(), "schlecht".to_string()]
        );
        adapter
            .create_schema("e2e_schema")
            .await
            .expect("create schema");
        let overview = adapter.get_database_overview().await.expect("overview");
        assert!(overview.size_bytes > 0);
        assert!(overview.schemas.iter().any(|s| s.schema == "e2e_schema"));
        assert!(adapter.drop_schema("public", false).await.is_err());
        lab_execute(&adapter, "DROP TYPE public.e2e_mood").await;
        adapter
            .drop_schema("e2e_schema", false)
            .await
            .expect("drop schema");
    }
}
