use super::{
    client, crypto,
    model::Credentials,
    server::{self, ServerState},
};
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::time::{Duration, Instant};

const PASSWORD: &str = "workspace-test-password-2026";

struct Lab {
    state: ServerState,
    endpoint: String,
    admin: String,
    task: tokio::task::JoinHandle<()>,
    source: tempfile::NamedTempFile,
}

impl Drop for Lab {
    fn drop(&mut self) {
        self.task.abort();
    }
}

impl Lab {
    async fn start(local_files: bool) -> Self {
        let state = ServerState::initialize(Connection::open_in_memory().unwrap(), [17; 32])
            .unwrap()
            .with_local_files(local_files);
        state
            .bootstrap(Credentials {
                email: "admin@example.test".into(),
                password: PASSWORD.into(),
            })
            .unwrap();
        let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0))
            .await
            .unwrap();
        let endpoint = format!("http://{}", listener.local_addr().unwrap());
        let app = server::router(state.clone());
        let task = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .await
            .unwrap();
        });
        let login = client::http(
            &endpoint,
            None,
            "POST",
            "api/login",
            Some(json!({"email":"admin@example.test","password":PASSWORD})),
        )
        .await
        .unwrap();
        let source = tempfile::NamedTempFile::new().unwrap();
        Connection::open(source.path()).unwrap().execute_batch("CREATE TABLE items(id INTEGER PRIMARY KEY,name TEXT); INSERT INTO items VALUES(1,'first'),(2,'second'),(3,'third');").unwrap();
        Self {
            state,
            endpoint,
            admin: login["token"].as_str().unwrap().into(),
            task,
            source,
        }
    }

    async fn request(
        &self,
        token: &str,
        method: &str,
        path: &str,
        body: Value,
    ) -> Result<Value, String> {
        client::http(
            &self.endpoint,
            Some(token),
            method,
            &format!("api/{path}"),
            (!body.is_null()).then_some(body),
        )
        .await
    }

    async fn connection(&self, approval: bool) -> String {
        let created=self.request(&self.admin,"POST","connections",json!({"name":"Shared SQLite","kind":"sqlite","database":null,"connectionString":format!("sqlite://{}",self.source.path().display()),"requireApproval":approval})).await.unwrap();
        created["id"].as_str().unwrap().into()
    }

    async fn member(&self, email: &str, role: &str) -> (String, String) {
        let invitation = self
            .request(
                &self.admin,
                "POST",
                "invitations",
                json!({"email":email,"role":role}),
            )
            .await
            .unwrap();
        client::http(
            &self.endpoint,
            None,
            "POST",
            "api/invitations/accept",
            Some(json!({"email":email,"password":PASSWORD,"token":invitation["token"]})),
        )
        .await
        .unwrap();
        assert!(client::http(
            &self.endpoint,
            None,
            "POST",
            "api/invitations/accept",
            Some(json!({"email":email,"password":PASSWORD,"token":invitation["token"]}))
        )
        .await
        .is_err());
        let session = client::http(
            &self.endpoint,
            None,
            "POST",
            "api/login",
            Some(json!({"email":email,"password":PASSWORD})),
        )
        .await
        .unwrap();
        (
            session["token"].as_str().unwrap().into(),
            session["user"]["id"].as_str().unwrap().into(),
        )
    }

    async fn grant(&self, connection: &str, user: &str, access: &str) {
        self.request(
            &self.admin,
            "PUT",
            &format!("connections/{connection}/grants"),
            json!({"userId":user,"access":access}),
        )
        .await
        .unwrap();
    }
}

#[test]
fn workspace_credentials_are_authenticated_and_bound_to_connection() {
    let key = [71; 32];
    let encrypted = crypto::seal(&key, "a", "postgres://me:secret@db/app").unwrap();
    assert!(!encrypted.contains("secret"));
    assert_eq!(
        crypto::open(&key, "a", &encrypted).unwrap(),
        "postgres://me:secret@db/app"
    );
    assert!(crypto::open(&key, "b", &encrypted).is_err());
    assert!(crypto::open(&[72; 32], "a", &encrypted).is_err());
    let salt = crypto::random::<16>().unwrap();
    let hash = crypto::password_hash(PASSWORD, &salt).unwrap();
    assert!(crypto::password_matches(PASSWORD, &salt, &hash));
    assert!(!crypto::password_matches(
        "different-password",
        &salt,
        &hash
    ));
    assert!(client::validate_endpoint("https://team.example.test/prefix").is_ok());
    for url in [
        "http://team.example.test",
        "https://me:secret@team.example.test",
        "https://team.example.test?token=secret",
        "file:///etc/passwd",
    ] {
        assert!(client::validate_endpoint(url).is_err());
    }
}

#[tokio::test]
async fn workspace_local_http_auth_permissions_metadata_and_revocation() {
    let lab = Lab::start(true).await;
    let id = lab.connection(false).await;
    let (member, user) = lab.member("member@example.test", "member").await;
    let empty = lab
        .request(&member, "GET", "connections", Value::Null)
        .await
        .unwrap();
    assert_eq!(empty["items"].as_array().unwrap().len(), 0);
    assert!(lab
        .request(&member, "GET", "users", Value::Null)
        .await
        .is_err());
    assert!(lab
        .request(
            &member,
            "POST",
            &format!("connections/{id}/query"),
            json!({"sql":"SELECT 1"})
        )
        .await
        .is_err());
    lab.grant(&id, &user, "read").await;
    let list = lab
        .request(&member, "GET", "connections", Value::Null)
        .await
        .unwrap();
    let serialized = list.to_string();
    assert!(!serialized.contains("sqlite://"));
    assert!(!serialized.contains(&lab.source.path().to_string_lossy().to_string()));
    let tables = lab
        .request(
            &member,
            "POST",
            &format!("connections/{id}/metadata"),
            json!({"operation":"tables","schema":"main"}),
        )
        .await
        .unwrap();
    assert_eq!(tables[0]["name"], "items");
    let result = lab
        .request(
            &member,
            "POST",
            &format!("connections/{id}/query"),
            json!({"sql":"SELECT name FROM items ORDER BY id","maxRows":2}),
        )
        .await
        .unwrap();
    assert_eq!(result["rows"].as_array().unwrap().len(), 2);
    assert_eq!(result["rows"][0]["name"], "first");
    assert_eq!(result["truncated"], true);
    for sql in [
        "DELETE FROM items",
        "PRAGMA writable_schema=ON",
        "WITH removed AS (DELETE FROM items RETURNING id) SELECT * FROM removed",
        "SELECT 1; DELETE FROM items",
    ] {
        assert!(lab
            .request(
                &member,
                "POST",
                &format!("connections/{id}/query"),
                json!({"sql":sql})
            )
            .await
            .is_err());
    }
    assert_eq!(
        Connection::open(lab.source.path())
            .unwrap()
            .query_row("SELECT COUNT(*) FROM items", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        3
    );
    let encrypted: String = lab
        .state
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT credentials FROM connections WHERE id=?1",
            [&id],
            |row| row.get(0),
        )
        .unwrap();
    assert!(!encrypted.contains("sqlite"));
    lab.request(
        &lab.admin,
        "POST",
        &format!("users/{user}/revoke"),
        Value::Null,
    )
    .await
    .unwrap();
    assert!(lab
        .request(&member, "GET", "me", Value::Null)
        .await
        .is_err());
    let browser = reqwest::Client::new()
        .post(format!("{}/api/login", lab.endpoint))
        .header("Origin", "https://attacker.example")
        .json(&json!({"email":"admin@example.test","password":PASSWORD}))
        .send()
        .await
        .unwrap();
    assert_eq!(browser.status().as_u16(), 403);
}

#[tokio::test]
async fn workspace_native_files_require_explicit_local_mode() {
    let lab = Lab::start(false).await;
    let input = json!({"name":"No file access","kind":"sqlite","database":null,"connectionString":format!("sqlite://{}",lab.source.path().display())});
    assert!(lab
        .request(&lab.admin, "POST", "connections", input)
        .await
        .unwrap_err()
        .contains("lokalen"));
    for database in ["x".repeat(257), "invalid\nname".into()] {
        let input = json!({"name":"Bounded database metadata","kind":"postgres","database":database,"connectionString":"postgresql://test:test@127.0.0.1:9/testdb"});
        assert!(lab
            .request(&lab.admin, "POST", "connections", input)
            .await
            .unwrap_err()
            .contains("Datenbankname"));
    }
    let maximum = "x".repeat(256);
    let input = json!({"name":"Maximum database name","kind":"postgres","database":maximum,"connectionString":"postgresql://test:test@127.0.0.1:9/testdb"});
    lab.request(&lab.admin, "POST", "connections", input)
        .await
        .unwrap();
    let list = lab
        .request(&lab.admin, "GET", "connections", Value::Null)
        .await
        .unwrap();
    assert_eq!(list["items"][0]["database"].as_str().unwrap().len(), 256);
    let input = json!({"name":"No Redis fallback","kind":"redis","database":null,"connectionString":"redis://127.0.0.1:6379"});
    assert!(lab
        .request(&lab.admin, "POST", "connections", input)
        .await
        .is_err());
}

#[tokio::test]
async fn workspace_sql_revisions_and_four_eyes_approval_are_atomic() {
    let lab = Lab::start(true).await;
    let id = lab.connection(true).await;
    let (member, user) = lab.member("writer@example.test", "member").await;
    lab.grant(&id, &user, "write").await;
    let saved = lab
        .request(
            &member,
            "POST",
            "queries",
            json!({"connectionId":id,"name":"Shared","sql":"SELECT 1"}),
        )
        .await
        .unwrap();
    let changed=lab.request(&member,"POST","queries",json!({"id":saved["id"],"expectedRevision":1,"connectionId":id,"name":"Shared","sql":"SELECT 2"})).await.unwrap();
    assert_eq!(changed["revision"], 2);
    let stale=lab.request(&member,"POST","queries",json!({"id":saved["id"],"expectedRevision":1,"connectionId":id,"name":"Stale","sql":"SELECT 3"})).await.unwrap_err();
    assert!(stale.contains("inzwischen geändert"));
    let queued = lab
        .request(
            &member,
            "POST",
            &format!("connections/{id}/query"),
            json!({"sql":"INSERT INTO items VALUES(4,'approved')"}),
        )
        .await
        .unwrap_err();
    assert!(queued.contains("Freigabe"));
    let pending = lab
        .request(&lab.admin, "GET", "pending", Value::Null)
        .await
        .unwrap();
    let pending_id = pending["items"][0]["id"].as_str().unwrap();
    lab.request(
        &lab.admin,
        "POST",
        &format!("pending/{pending_id}/approve"),
        Value::Null,
    )
    .await
    .unwrap();
    assert!(lab
        .request(
            &lab.admin,
            "POST",
            &format!("pending/{pending_id}/approve"),
            Value::Null
        )
        .await
        .is_err());
    let db = Connection::open(lab.source.path()).unwrap();
    assert_eq!(
        db.query_row("SELECT COUNT(*) FROM items WHERE id=4", [], |row| row
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
    lab.request(
        &lab.admin,
        "POST",
        &format!("connections/{id}/query"),
        json!({"sql":"DELETE FROM items"}),
    )
    .await
    .unwrap_err();
    let pending = lab
        .request(&lab.admin, "GET", "pending", Value::Null)
        .await
        .unwrap();
    let pending_id = pending["items"][0]["id"].as_str().unwrap();
    assert!(lab
        .request(
            &lab.admin,
            "POST",
            &format!("pending/{pending_id}/approve"),
            Value::Null
        )
        .await
        .unwrap_err()
        .contains("selbst"));
}

#[tokio::test]
async fn workspace_cancellation_stops_real_sqlite_work_and_returns_to_idle() {
    let lab = Lab::start(true).await;
    let connection = lab.connection(false).await;
    let endpoint = lab.endpoint.clone();
    let token = lab.admin.clone();
    let query_connection = connection.clone();
    let pending = tokio::spawn(async move {
        client::http(&endpoint,Some(&token),"POST",&format!("api/connections/{query_connection}/query"),Some(json!({"sql":"WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n","jobId":"cancel-test"}))).await
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    while lab.state.active_jobs() == 0 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_eq!(lab.state.active_jobs(), 1);
    let started = Instant::now();
    lab.request(
        &lab.admin,
        "POST",
        &format!("connections/{connection}/cancel"),
        json!({"jobId":"cancel-test"}),
    )
    .await
    .unwrap();
    assert!(tokio::time::timeout(Duration::from_secs(2), pending)
        .await
        .unwrap()
        .unwrap()
        .is_err());
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(lab.state.active_jobs(), 0);
    let count: i64 = lab
        .state
        .db
        .lock()
        .unwrap()
        .query_row("SELECT count(*) FROM logs", [], |row| row.get(0))
        .unwrap();
    tokio::time::sleep(Duration::from_millis(80)).await;
    assert_eq!(lab.state.active_jobs(), 0);
    assert_eq!(
        lab.state
            .db
            .lock()
            .unwrap()
            .query_row("SELECT count(*) FROM logs", [], |row| row.get::<_, i64>(0))
            .unwrap(),
        count
    );
}

#[tokio::test]
async fn workspace_performance_large_team_and_audit_pages_stay_bounded() {
    let lab = Lab::start(true).await;
    {
        let mut db = lab.state.db.lock().unwrap();
        let tx = db.transaction().unwrap();
        for index in 0..10_000 {
            tx.execute("INSERT INTO users(id,email,role,active,salt,hash) VALUES(?1,?2,'member',1,x'00',x'00')",params![format!("user-{index}"),format!("member-{index:05}@example.test")]).unwrap();
        }
        for index in 0..50_000 {
            tx.execute("INSERT INTO logs(actor,action,outcome,created) VALUES('admin@example.test','query.execute','ok',?1)",[index]).unwrap();
        }
        tx.commit().unwrap();
    }
    let mut durations = Vec::new();
    let mut maximum_bytes = 0;
    for run in 0..15 {
        let started = Instant::now();
        let users = lab
            .request(&lab.admin, "GET", "users", json!({"offset":run*100}))
            .await
            .unwrap();
        let logs = lab
            .request(&lab.admin, "GET", "logs", json!({"offset":run*100}))
            .await
            .unwrap();
        durations.push(started.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(users["items"].as_array().unwrap().len(), 100);
        assert_eq!(logs["items"].as_array().unwrap().len(), 100);
        maximum_bytes = maximum_bytes.max(users.to_string().len() + logs.to_string().len());
        assert_eq!(lab.state.active_jobs(), 0);
    }
    durations.sort_by(f64::total_cmp);
    eprintln!("workspace local HTTP: 10000 users/50000 audit events, 2 requests/run, 100 rows/page, median {:.2} ms p95 {:.2} ms, retained response {} bytes, zero background jobs",durations[7],durations[14],maximum_bytes);
    assert!(durations[7] < 100.0);
    assert!(durations[14] < 250.0);
    assert!(maximum_bytes < 128 * 1024);
}

#[tokio::test]
async fn workspace_revocation_cancels_running_member_query_and_login_is_rate_limited() {
    let lab = Lab::start(true).await;
    let connection = lab.connection(false).await;
    let (member, user) = lab.member("reader@example.test", "member").await;
    lab.grant(&connection, &user, "read").await;
    let endpoint = lab.endpoint.clone();
    let token = member.clone();
    let query_connection = connection.clone();
    let pending = tokio::spawn(async move {
        client::http(&endpoint,Some(&token),"POST",&format!("api/connections/{query_connection}/query"),Some(json!({"sql":"WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n","jobId":"revoked-job"}))).await
    });
    let deadline = Instant::now() + Duration::from_secs(3);
    while lab.state.active_jobs() == 0 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_eq!(lab.state.active_jobs(), 1);
    lab.request(
        &lab.admin,
        "POST",
        &format!("users/{user}/revoke"),
        Value::Null,
    )
    .await
    .unwrap();
    assert!(tokio::time::timeout(Duration::from_secs(2), pending)
        .await
        .unwrap()
        .unwrap()
        .is_err());
    assert_eq!(lab.state.active_jobs(), 0);
    assert!(lab
        .request(&member, "GET", "me", Value::Null)
        .await
        .is_err());
    for _ in 0..10 {
        assert!(client::http(
            &lab.endpoint,
            None,
            "POST",
            "api/login",
            Some(json!({"email":"unknown@example.test","password":PASSWORD}))
        )
        .await
        .is_err());
    }
    let limited = client::http(
        &lab.endpoint,
        None,
        "POST",
        "api/login",
        Some(json!({"email":"unknown@example.test","password":PASSWORD})),
    )
    .await
    .unwrap_err();
    assert!(limited.contains("Anmeldeversuche"));
}

#[tokio::test]
async fn workspace_retained_sql_and_single_large_results_have_hard_limits() {
    let lab = Lab::start(true).await;
    let connection = lab.connection(false).await;
    let oversized = lab
        .request(
            &lab.admin,
            "POST",
            &format!("connections/{connection}/query"),
            json!({"sql":"SELECT hex(zeroblob(2300000)) AS large_value"}),
        )
        .await
        .unwrap_err();
    assert!(oversized.contains("4 MB"));
    assert_eq!(lab.state.active_jobs(), 0);
    let sql = format!("SELECT 1 {}", " ".repeat(super::model::MAX_SQL_BYTES - 9));
    assert_eq!(sql.len(), super::model::MAX_SQL_BYTES);
    for index in 0..8 {
        lab.request(
            &lab.admin,
            "POST",
            "queries",
            json!({"connectionId":connection,"name":format!("Large SQL {index}"),"sql":sql}),
        )
        .await
        .unwrap();
    }
    let error = lab
        .request(
            &lab.admin,
            "POST",
            "queries",
            json!({"connectionId":connection,"name":"Over budget","sql":"SELECT 1"}),
        )
        .await
        .unwrap_err();
    assert!(error.contains("8 MB"));
    let bytes: i64 = lab
        .state
        .db
        .lock()
        .unwrap()
        .query_row(
            "SELECT sum(length(CAST(sql AS BLOB))) FROM saved_queries",
            [],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(bytes, 8 * 1024 * 1024);
    let list = lab
        .request(
            &lab.admin,
            "GET",
            "queries",
            json!({"connectionId":connection}),
        )
        .await
        .unwrap();
    assert_eq!(list["items"].as_array().unwrap().len(), 8);
    assert!(list.to_string().len() < 16 * 1024);
    assert!(list["items"][0].get("sql").is_none());
    let id = list["items"][0]["id"].as_str().unwrap();
    let detail = lab
        .request(&lab.admin, "GET", &format!("queries/{id}"), Value::Null)
        .await
        .unwrap();
    assert_eq!(
        detail["sql"].as_str().unwrap().len(),
        super::model::MAX_SQL_BYTES
    );
}

#[tokio::test]
#[ignore = "Benötigt das lokale PostgreSQL-Lab auf Port 15433"]
async fn workspace_live_postgres_native_readonly_blocks_security_definer_writes() {
    use crate::db::{create_adapter_from_string, pool::create_pool_state, DatabaseKind};
    let url = std::env::var("L8DB_WORKSPACE_PG_URL")
        .expect("L8DB_WORKSPACE_PG_URL muss auf eine entbehrliche Testdatenbank zeigen");
    let source =
        create_adapter_from_string(DatabaseKind::Postgres, &url, None, create_pool_state())
            .unwrap();
    let suffix = crypto::id().unwrap().replace('-', "_").to_lowercase();
    let table = format!("l8db_ws_{suffix}");
    let function = format!("l8db_ws_write_{suffix}");
    let qualified = format!("public.{}", crate::db::quote_ident(&table));
    let routine = format!("public.{}", crate::db::quote_ident(&function));
    source
        .execute_query(&format!(
            "CREATE TABLE {qualified}(id integer PRIMARY KEY,value text)"
        ))
        .await
        .unwrap();
    source
        .execute_query(&format!("INSERT INTO {qualified} VALUES(1,'visible')"))
        .await
        .unwrap();
    source.execute_query(&format!("CREATE FUNCTION {routine}() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN INSERT INTO {qualified} VALUES(2,'forbidden'); RETURN 1; END; $$")).await.unwrap();
    let lab = Lab::start(false).await;
    let connection=lab.request(&lab.admin,"POST","connections",json!({"name":"PostgreSQL lab","kind":"postgres","database":null,"connectionString":url,"requireApproval":false})).await.unwrap()["id"].as_str().unwrap().to_string();
    let (reader, user) = lab.member("pg-reader@example.test", "member").await;
    lab.grant(&connection, &user, "read").await;
    let columns = lab
        .request(
            &reader,
            "POST",
            &format!("connections/{connection}/metadata"),
            json!({"operation":"columns","schema":"public","table":table}),
        )
        .await;
    let result = lab
        .request(
            &reader,
            "POST",
            &format!("connections/{connection}/query"),
            json!({"sql":format!("SELECT value FROM {qualified}")}),
        )
        .await;
    let blocked = lab
        .request(
            &reader,
            "POST",
            &format!("connections/{connection}/query"),
            json!({"sql":format!("SELECT {routine}()")}),
        )
        .await;
    let rows = source
        .execute_query(&format!("SELECT count(*) AS amount FROM {qualified}"))
        .await
        .unwrap();
    source
        .execute_query(&format!("DROP FUNCTION {routine}()"))
        .await
        .unwrap();
    source
        .execute_query(&format!("DROP TABLE {qualified}"))
        .await
        .unwrap();
    assert_eq!(columns.unwrap().as_array().unwrap().len(), 2);
    assert_eq!(result.unwrap()["rows"][0]["value"], "visible");
    assert!(blocked.is_err());
    assert_eq!(
        rows.rows[0]["amount"]
            .as_i64()
            .or_else(|| rows.rows[0]["amount"].as_str().and_then(|v| v.parse().ok())),
        Some(1)
    );
}

#[tokio::test]
async fn workspace_bounds_live_query_concurrency_and_cancels_all_abandoned_work() {
    let lab = Lab::start(true).await;
    let connection = lab.connection(false).await;
    let approval_connection = lab.connection(true).await;
    let (writer, writer_id) = lab.member("approval-writer@example.test", "member").await;
    lab.grant(&approval_connection, &writer_id, "write").await;
    let queued = lab
        .request(
            &writer,
            "POST",
            &format!("connections/{approval_connection}/query"),
            json!({"sql":"UPDATE items SET name=name||'-approved' WHERE id=1"}),
        )
        .await
        .unwrap_err();
    assert!(queued.contains("Freigabe"));
    let pending = lab
        .request(&lab.admin, "GET", "pending", Value::Null)
        .await
        .unwrap();
    let pending_id = pending["items"][0]["id"].as_str().unwrap();
    let approval_path = format!("pending/{pending_id}/approve");
    let mut jobs = Vec::new();
    for index in 0..4 {
        let endpoint = lab.endpoint.clone();
        let token = lab.admin.clone();
        let id = connection.clone();
        jobs.push(tokio::spawn(async move{client::http(&endpoint,Some(&token),"POST",&format!("api/connections/{id}/query"),Some(json!({"sql":"WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n","jobId":format!("parallel-{index}")}))).await}));
    }
    let deadline = Instant::now() + Duration::from_secs(3);
    while lab.state.active_jobs() < 4 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_eq!(lab.state.active_jobs(), 4);
    let fifth = lab
        .request(
            &lab.admin,
            "POST",
            &format!("connections/{connection}/query"),
            json!({"sql":"SELECT 1","jobId":"fifth-query"}),
        )
        .await
        .unwrap_err();
    assert!(fifth.contains("Vier"));
    let approval_error = lab
        .request(&lab.admin, "POST", &approval_path, Value::Null)
        .await
        .unwrap_err();
    assert!(approval_error.contains("Vier"));
    let waiting = lab
        .request(
            &lab.admin,
            "GET",
            &format!("pending/{pending_id}"),
            Value::Null,
        )
        .await
        .unwrap();
    assert_eq!(waiting["status"], "pending");
    assert_eq!(
        Connection::open(lab.source.path())
            .unwrap()
            .query_row("SELECT name FROM items WHERE id=1", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "first"
    );

    for index in 0..4 {
        lab.request(
            &lab.admin,
            "POST",
            &format!("connections/{connection}/cancel"),
            json!({"jobId":format!("parallel-{index}")}),
        )
        .await
        .unwrap();
    }
    for pending in jobs {
        assert!(tokio::time::timeout(Duration::from_secs(2), pending)
            .await
            .unwrap()
            .unwrap()
            .is_err());
    }
    assert_eq!(lab.state.active_jobs(), 0);
    let (first, second) = tokio::join!(
        lab.request(&lab.admin, "POST", &approval_path, Value::Null),
        lab.request(&lab.admin, "POST", &approval_path, Value::Null),
    );
    assert_ne!(first.is_ok(), second.is_ok());
    assert_eq!(
        Connection::open(lab.source.path())
            .unwrap()
            .query_row("SELECT name FROM items WHERE id=1", [], |row| row
                .get::<_, String>(0))
            .unwrap(),
        "first-approved"
    );
    let approved = lab
        .request(
            &lab.admin,
            "GET",
            &format!("pending/{pending_id}"),
            Value::Null,
        )
        .await
        .unwrap();
    assert_eq!(approved["status"], "executed");
}

#[tokio::test]
async fn workspace_login_spray_cannot_lock_proxy_users_and_forwarded_headers_cannot_bypass_limits()
{
    let lab = Lab::start(false).await;
    let http = reqwest::Client::new();
    let mut limited = 0;
    for index in 0..256 {
        let response = http
            .post(format!("{}/api/login", lab.endpoint))
            .json(&json!({"email":format!("stranger-{index}@example.test"),"password":PASSWORD}))
            .send()
            .await
            .unwrap();
        assert!(matches!(response.status().as_u16(), 401 | 429));
        if response.status().as_u16() == 429 {
            limited += 1;
        }
    }
    assert!(limited > 0);
    let spoofed = http
        .post(format!("{}/api/login", lab.endpoint))
        .header("X-Forwarded-For", "203.0.113.9")
        .header("Forwarded", "for=203.0.113.9")
        .json(&json!({"email":"another-stranger@example.test","password":PASSWORD}))
        .send()
        .await
        .unwrap();
    assert_eq!(spoofed.status().as_u16(), 429);
    let valid = client::http(
        &lab.endpoint,
        None,
        "POST",
        "api/login",
        Some(json!({"email":"admin@example.test","password":PASSWORD})),
    )
    .await
    .unwrap();
    assert!(valid["token"].is_string());
    let (new_user, _) = lab.member("new-proxy-user@example.test", "member").await;
    assert!(lab
        .request(&new_user, "GET", "me", Value::Null)
        .await
        .is_ok());
}

#[test]
fn workspace_login_limits_evict_counters_without_unlocking_targeted_accounts_or_other_clients() {
    use super::login::LoginLimits;
    use std::net::{IpAddr, Ipv4Addr};
    let mut limits = LoginLimits::default();
    let at = Instant::now();
    let proxy = IpAddr::V4(Ipv4Addr::LOCALHOST);
    for _ in 0..10 {
        assert!(limits.admit(Some("target"), "target@example.test", proxy, at));
    }
    assert!(!limits.admit(Some("target"), "target@example.test", proxy, at));
    for index in 0..4096u16 {
        let peer = IpAddr::V4(Ipv4Addr::new(198, 18, (index >> 8) as u8, index as u8));
        assert!(limits.admit(None, &format!("unknown-{index}@example.test"), peer, at));
        limits.failed(peer, at);
    }
    assert_eq!(limits.sizes(), [1, 256, 256]);
    assert!(!limits.admit(Some("target"), "target@example.test", proxy, at));
    assert!(limits.admit(
        None,
        "new-client@example.test",
        IpAddr::V4(Ipv4Addr::new(203, 0, 113, 44)),
        at
    ));
    for index in 0..32 {
        assert!(limits.admit(None, &format!("proxy-{index}@example.test"), proxy, at));
        limits.failed(proxy, at);
    }
    assert!(!limits.admit(None, "proxy-new@example.test", proxy, at));
    assert!(limits.admit(Some("other-account"), "real-user@example.test", proxy, at));
    limits.succeeded("other-account", "real-user@example.test");
    assert!(!limits.admit(None, "proxy-new@example.test", proxy, at));
    assert!(limits.admit(
        Some("target"),
        "target@example.test",
        proxy,
        at + Duration::from_secs(301)
    ));
    assert!(limits.retained_key_and_bucket_bytes() < 256 * 1024);
}

#[test]
fn workspace_login_limit_performance_bounds_spray_memory_and_latency() {
    use super::login::LoginLimits;
    use std::net::{IpAddr, Ipv4Addr};
    let mut samples = Vec::new();
    let mut retained = 0;
    for _ in 0..15 {
        let mut limits = LoginLimits::default();
        let at = Instant::now();
        let started = Instant::now();
        for index in 0..1024u16 {
            let id = format!("{index:032}");
            let address = format!("{index:0240}@example.test");
            let peer = IpAddr::V4(Ipv4Addr::new(198, 18, (index >> 8) as u8, index as u8));
            let account = (index % 4 == 0).then_some(id.as_str());
            assert!(limits.admit(account, &address, peer, at));
            limits.failed(peer, at);
        }
        samples.push(started.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(limits.sizes(), [256, 256, 256]);
        retained = retained.max(limits.retained_key_and_bucket_bytes());
    }
    samples.sort_by(f64::total_cmp);
    eprintln!("workspace login limiter: 1024 clients/15 samples, 256 counters per account/unknown-email/peer map, median {:.2} ms p95 {:.2} ms, retained key+bucket capacity {} bytes, zero password jobs/database requests/background tasks",samples[7],samples[14],retained);
    assert!(samples[7] < 100.0);
    assert!(samples[14] < 250.0);
    assert!(retained < 256 * 1024);
}

#[tokio::test]
async fn workspace_get_numeric_ids_keep_their_text_and_offsets_still_paginate() {
    let lab = Lab::start(true).await;
    let id = "000123";
    lab.request(&lab.admin,"POST","connections",json!({"id":id,"name":"Numeric ID","kind":"sqlite","database":null,"connectionString":format!("sqlite://{}",lab.source.path().display())})).await.unwrap();
    for name in ["First", "Second"] {
        lab.request(
            &lab.admin,
            "POST",
            "queries",
            json!({"connectionId":id,"name":name,"sql":"SELECT 1"}),
        )
        .await
        .unwrap();
    }
    let page = lab
        .request(
            &lab.admin,
            "GET",
            "queries",
            json!({"connectionId":id,"offset":1}),
        )
        .await
        .unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(page["items"][0]["name"], "Second");
    assert_eq!(page["items"][0]["connectionId"], id);
    assert_eq!(page["more"], false);
}
