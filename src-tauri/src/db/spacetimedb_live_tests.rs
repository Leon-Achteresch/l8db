use super::*;
use crate::cloud_accounts::{spacetime as account, store::memory::MemoryVault};
use crate::db::execution::{self, ExecutionOptions};
use axum::{body::Body as HttpBody, extract::State, http::Request, response::Response, Router};
use futures_util::{stream, StreamExt};
use serde::Deserialize;
use serde_json::json;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering as AtomicOrdering};
use std::sync::Arc;
use std::time::{Duration, Instant};

#[derive(Deserialize)]
struct Lab {
    base: String,
    database: String,
    token: String,
    identity: String,
}

impl Lab {
    fn load() -> Self {
        if let Ok(path) = std::env::var("L8DB_SPACETIME_LAB_CONFIG") {
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = std::fs::metadata(&path).unwrap().permissions().mode();
                assert_eq!(mode & 0o077, 0, "Lab credentials must be private");
            }
            return serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        }
        let token = std::env::var("L8DB_E2E_SPACETIME_TOKEN").expect("SpacetimeDB lab token");
        Self {
            base: std::env::var("L8DB_E2E_SPACETIME_URL").expect("SpacetimeDB lab URL"),
            database: std::env::var("L8DB_E2E_SPACETIME_DATABASE")
                .expect("SpacetimeDB lab database"),
            identity: account::token_identity(&token, None).unwrap(),
            token,
        }
    }

    fn adapter_at(&self, base: &url::Url, token: &str) -> SpacetimeAdapter {
        let mut url =
            url::Url::parse(&account::connection_string(base, &self.database).unwrap()).unwrap();
        url.set_password(Some(token)).unwrap();
        SpacetimeAdapter::new(url.as_str(), None).unwrap()
    }
}

#[derive(Default)]
struct Metrics {
    requests: AtomicUsize,
    sql: AtomicUsize,
    active: AtomicUsize,
    max_active: AtomicUsize,
    bytes: AtomicUsize,
    delay_ms: AtomicU64,
}

struct Active(Arc<Metrics>);

impl Drop for Active {
    fn drop(&mut self) {
        self.0.active.fetch_sub(1, AtomicOrdering::SeqCst);
    }
}

#[derive(Clone)]
struct Forward {
    base: url::Url,
    metrics: Arc<Metrics>,
}

async fn forward(State(state): State<Forward>, request: Request<HttpBody>) -> Response {
    let (parts, body) = request.into_parts();
    let metrics = state.metrics;
    metrics.requests.fetch_add(1, AtomicOrdering::SeqCst);
    if parts.uri.path().ends_with("/sql") {
        metrics.sql.fetch_add(1, AtomicOrdering::SeqCst);
    }
    let active = metrics.active.fetch_add(1, AtomicOrdering::SeqCst) + 1;
    metrics.max_active.fetch_max(active, AtomicOrdering::SeqCst);
    let guard = Active(metrics.clone());
    let body = axum::body::to_bytes(body, 128 * 1024).await.unwrap();
    let url = state.base.join(&parts.uri.to_string()).unwrap();
    let mut upstream = cloud_http::client().request(parts.method, url).body(body);
    for name in ["authorization", "content-type", "accept"] {
        if let Some(value) = parts.headers.get(name) {
            upstream = upstream.header(name, value);
        }
    }
    let response = upstream.send().await.unwrap();
    let status = response.status();
    let output = stream::unfold(
        (response.bytes_stream(), guard, true),
        move |(mut upstream, guard, first)| {
            let metrics = metrics.clone();
            async move {
                if first {
                    let delay = metrics.delay_ms.load(AtomicOrdering::SeqCst);
                    if delay != 0 {
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                    }
                }
                upstream.next().await.map(|chunk| {
                    let chunk = chunk.map_err(std::io::Error::other);
                    if let Ok(bytes) = &chunk {
                        metrics.bytes.fetch_add(bytes.len(), AtomicOrdering::SeqCst);
                    }
                    (chunk, (upstream, guard, false))
                })
            }
        },
    );
    Response::builder()
        .status(status)
        .body(HttpBody::from_stream(output))
        .unwrap()
}

struct Proxy {
    base: url::Url,
    metrics: Arc<Metrics>,
    server: tokio::task::JoinHandle<()>,
}

impl Drop for Proxy {
    fn drop(&mut self) {
        self.server.abort();
    }
}

impl Proxy {
    async fn start(base: &str) -> Self {
        let base = url::Url::parse(base).unwrap();
        assert!(base.host().as_ref().is_some_and(cloud_http::is_loopback));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let metrics = Arc::new(Metrics::default());
        let router = Router::new().fallback(forward).with_state(Forward {
            base,
            metrics: metrics.clone(),
        });
        let server = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
        Self {
            base: url::Url::parse(&format!("http://{address}/")).unwrap(),
            metrics,
            server,
        }
    }

    fn requests(&self) -> usize {
        self.metrics.requests.load(AtomicOrdering::SeqCst)
    }

    async fn idle(&self) {
        tokio::time::timeout(Duration::from_secs(2), async {
            while self.metrics.active.load(AtomicOrdering::SeqCst) != 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("HTTP response body released");
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
#[ignore = "requires scripts/test-spacetimedb-live.sh lab"]
async fn live_spacetime_account_adapter_limits_performance_cancel_and_idle() {
    let lab = Lab::load();
    let proxy = Proxy::start(&lab.base).await;
    let adapter = lab.adapter_at(&proxy.base, &lab.token);
    let target = account::target(&proxy.base, &lab.database, &lab.token).unwrap();
    account::verify(&proxy.base, &lab.identity, &lab.token)
        .await
        .unwrap();
    assert!(account::verify(&proxy.base, &"0".repeat(64), &lab.token)
        .await
        .is_err());
    let vault = MemoryVault::default();
    let saved = account::add(
        &vault,
        "Spacetime live",
        &lab.token,
        Some(proxy.base.as_str()),
        None,
    )
    .await
    .unwrap();
    assert_eq!(saved.identity.as_deref(), Some(lab.identity.as_str()));
    let before = proxy.requests();
    let databases = account::databases_at(&proxy.base, &lab.identity, &lab.token)
        .await
        .unwrap();
    assert!(!databases.truncated);
    assert!(databases
        .databases
        .iter()
        .any(|db| db.names.contains(&lab.database)));
    assert_eq!(proxy.requests() - before, databases.databases.len() + 1);
    let connection = account::create_connection_at(
        &vault,
        &proxy.base,
        &lab.token,
        &lab.database,
        "Live fixture",
    )
    .await
    .unwrap();
    assert!(!connection.connection_string.contains(&lab.token));
    assert_eq!(
        vault.connections.lock().unwrap().get(&connection.id),
        Some(&lab.token)
    );
    adapter.test_connection().await.unwrap();
    assert_eq!(
        adapter.list_databases().await.unwrap(),
        vec![lab.database.clone()]
    );
    assert_eq!(adapter.list_schemas().await.unwrap(), vec![SCHEMA_NAME]);
    let tables = adapter.list_tables(None).await.unwrap();
    assert!(tables.iter().any(|table| table.name == "customer"));
    assert!(tables.iter().any(|table| table.name == "orders"));
    let module = module_schema(&target).await.unwrap();
    assert!(
        !module
            .tables
            .iter()
            .find(|table| table.name == "private_state")
            .unwrap()
            .public
    );
    let columns = adapter
        .list_columns(None, Some("customer"), None)
        .await
        .unwrap();
    assert!(columns
        .iter()
        .any(|column| column.name == "nickname" && column.data_type == "Option<String>"));
    assert!(columns
        .iter()
        .any(|column| column.name == "status"
            && column.data_type == "Enum(active | inactive | pending)"));
    assert_eq!(
        adapter
            .count_rows(SCHEMA_NAME, "customer", None, false)
            .await
            .unwrap(),
        10_000
    );
    let rows = adapter
        .fetch_rows(
            SCHEMA_NAME,
            "customer",
            Some("id <= 3"),
            3,
            0,
            Some("id"),
            false,
            false,
            false,
        )
        .await
        .unwrap();
    assert_eq!(rows.rows.len(), 3);
    assert_eq!(rows.rows[0]["id"], json!(1));
    assert_eq!(rows.rows[0]["nickname"], Value::Null);
    assert_eq!(rows.rows[0]["credit"], json!("100000000000000000001"));
    assert_eq!(rows.rows[0]["status"], json!("inactive"));
    assert_eq!(rows.rows[2]["nickname"], json!("Nick 3"));
    let page = adapter
        .fetch_rows(
            SCHEMA_NAME,
            "customer",
            Some("id <= 30"),
            10,
            10,
            Some("id"),
            false,
            false,
            false,
        )
        .await
        .unwrap();
    assert_eq!(page.rows[0]["id"], json!(11));
    assert_eq!(page.rows[9]["id"], json!(20));
    let before = proxy.requests();
    assert!(adapter
        .fetch_rows(
            SCHEMA_NAME,
            "customer",
            None,
            100,
            9_950,
            None,
            false,
            false,
            false
        )
        .await
        .is_err());
    assert!(adapter.execute_query("DELETE FROM customer").await.is_err());
    assert!(adapter
        .execute_query("SELECT * FROM customer; DELETE FROM customer")
        .await
        .is_err());
    assert!(adapter
        .execute_query("SELECT id FROM customer LIMIT 1 /* ' */; DELETE FROM customer WHERE id = 18446744073709551615 /* ' */")
        .await
        .unwrap_err()
        .contains("genau eine"));
    assert!(
        account::call_reducer_at(&target, "rename_customer", &json!([1, "changed"]), false)
            .await
            .is_err()
    );
    assert_eq!(proxy.requests(), before);
    assert!(account::call_reducer_at(&target, "init", &json!([]), true)
        .await
        .is_err());
    assert!(
        account::call_reducer_at(&target, "rename_customer", &json!([1]), true)
            .await
            .is_err()
    );
    account::call_reducer_at(
        &target,
        "rename_customer",
        &json!([1, "Live renamed"]),
        true,
    )
    .await
    .unwrap();
    let renamed = adapter
        .execute_query("SELECT name FROM customer WHERE id = 1")
        .await
        .unwrap();
    account::call_reducer_at(&target, "rename_customer", &json!([1, "Kunde 00001"]), true)
        .await
        .unwrap();
    assert_eq!(renamed.rows[0]["name"], json!("Live renamed"));
    let limited = execution::run(
        Some(ExecutionOptions {
            max_rows: Some(100),
            ..Default::default()
        }),
        false,
        adapter.execute_query("SELECT * FROM customer LIMIT 1000"),
    )
    .await
    .unwrap();
    assert_eq!(limited.rows.len(), 100);
    assert!(limited.truncated);
    let other = cloud_http::send(
        LABEL,
        &Auth::None,
        Method::POST,
        proxy.base.join("v1/identity").unwrap(),
        Body::Empty,
        INFO_LIMIT,
    )
    .await
    .unwrap();
    let other = parse_json(&other.body).unwrap();
    let visitor = lab.adapter_at(&proxy.base, other["token"].as_str().unwrap());
    assert_eq!(
        visitor
            .execute_query("SELECT id FROM customer LIMIT 1")
            .await
            .unwrap()
            .rows
            .len(),
        1
    );
    assert!(visitor
        .execute_query("SELECT * FROM private_state LIMIT 1")
        .await
        .is_err());
    account::call_reducer_at(
        &target,
        "set_large_order_payload",
        &json!([1, SQL_LIMIT + 1024]),
        true,
    )
    .await
    .unwrap();
    let oversized = adapter
        .execute_query("SELECT * FROM orders WHERE id = 1")
        .await;
    account::call_reducer_at(&target, "set_large_order_payload", &json!([1, 128]), true)
        .await
        .unwrap();
    assert!(oversized.unwrap_err().contains("größer als"));
    proxy.idle().await;
    let before = proxy.requests();
    let sql_before = proxy.metrics.sql.load(AtomicOrdering::SeqCst);
    let bytes_before = proxy.metrics.bytes.load(AtomicOrdering::SeqCst);
    let mut samples = Vec::new();
    let mut retained_bytes = 0;
    for _ in 0..9 {
        let started = Instant::now();
        let rows = adapter
            .fetch_rows(
                SCHEMA_NAME,
                "orders",
                None,
                1000,
                0,
                None,
                false,
                false,
                false,
            )
            .await
            .unwrap();
        samples.push(started.elapsed().as_secs_f64() * 1000.0);
        assert_eq!(rows.rows.len(), 1000);
        let bytes = serde_json::to_vec(&rows).unwrap().len();
        retained_bytes = retained_bytes.max(bytes);
        assert!(bytes < 300_000);
    }
    samples.sort_by(f64::total_cmp);
    assert!(samples[4] < 500.0, "median {}ms", samples[4]);
    assert!(samples[8] < 1500.0, "p95 {}ms", samples[8]);
    assert_eq!(proxy.requests() - before, 9);
    assert_eq!(
        proxy.metrics.sql.load(AtomicOrdering::SeqCst) - sql_before,
        9
    );
    let before = proxy.requests();
    let parallel = stream::iter(0..4)
        .map(|_| adapter.execute_query("SELECT * FROM customer LIMIT 1000"))
        .buffer_unordered(4)
        .collect::<Vec<_>>()
        .await;
    assert!(parallel.iter().all(Result::is_ok));
    assert_eq!(proxy.requests() - before, 4);
    assert!(proxy.metrics.max_active.load(AtomicOrdering::SeqCst) <= 4);
    proxy.idle().await;
    proxy.metrics.delay_ms.store(10_000, AtomicOrdering::SeqCst);
    let before = proxy.requests();
    let started = Instant::now();
    let cancelled = tokio::time::timeout(
        Duration::from_millis(100),
        adapter.execute_query("SELECT * FROM orders LIMIT 1000"),
    )
    .await;
    assert!(cancelled.is_err());
    assert!(started.elapsed() < Duration::from_millis(500));
    assert_eq!(proxy.requests() - before, 1);
    proxy.metrics.delay_ms.store(0, AtomicOrdering::SeqCst);
    proxy.idle().await;
    let requests = proxy.requests();
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(proxy.requests(), requests);
    assert_eq!(
        adapter
            .execute_query("SELECT id FROM customer LIMIT 1")
            .await
            .unwrap()
            .rows
            .len(),
        1
    );
    eprintln!("SpacetimeDB live: 10000 customers + 10000 orders; 9x1000 rows median={:.3}ms p95={:.3}ms; largest retained serialized page={} bytes; forwarded bytes={}; serial SQL requests=9; parallel requests=4; max concurrency={}; abandoned HTTP future released<500ms; idle requests=0; server-side SQL cancellation unavailable", samples[4], samples[8], retained_bytes, proxy.metrics.bytes.load(AtomicOrdering::SeqCst) - bytes_before, proxy.metrics.max_active.load(AtomicOrdering::SeqCst));
}
