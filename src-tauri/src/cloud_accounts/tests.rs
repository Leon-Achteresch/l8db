use super::http::{self, Auth, Body};
use super::store::memory::MemoryVault;
use super::store::{self, AuthMethod, Provider, Vault};
use super::{neon, oauth, planetscale, spacetime};
use crate::db::http_mock::{self, MockRequest};
use base64::Engine;
use reqwest::Method;
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

fn bytes(value: Value) -> Vec<u8> {
    value.to_string().into_bytes()
}

fn percentile(samples: &mut [Duration], fraction: f64) -> Duration {
    samples.sort();
    let index = ((samples.len() as f64 - 1.0) * fraction).round() as usize;
    samples[index]
}

fn neon_client(base: &str) -> neon::Client {
    neon::Client::new(
        http::base_url(neon::API, Some(base)).unwrap(),
        "neon-key".into(),
    )
}

#[test]
fn custom_endpoints_are_limited_to_loopback_without_credentials() {
    for allowed in [
        "http://127.0.0.1:9000",
        "http://localhost:9000/api/",
        "https://[::1]:8443",
    ] {
        let url = http::base_url(neon::API, Some(allowed)).unwrap();
        assert!(url.path().ends_with('/'), "{url}");
    }
    for rejected in [
        "https://console.neon.tech.evil.example/api/v2",
        "http://10.0.0.5:8080",
        "http://user:pass@127.0.0.1:9000",
        "http://127.0.0.1:9000/?next=evil",
        "ftp://127.0.0.1/",
        "file:///etc/passwd",
    ] {
        assert!(
            http::base_url(neon::API, Some(rejected)).is_err(),
            "{rejected}"
        );
    }
    assert_eq!(http::base_url(neon::API, None).unwrap().as_str(), neon::API);
    assert_eq!(
        http::base_url(neon::API, Some("  ")).unwrap().as_str(),
        neon::API
    );
}

#[test]
fn path_segments_and_queries_are_escaped() {
    let base = http::base_url(neon::API, None).unwrap();
    let url = http::endpoint(
        &base,
        &["projects", "a/b?c#d", "roles", "my role"],
        &[("search", "x&y=z".into())],
    )
    .unwrap();
    assert_eq!(
        url.as_str(),
        "https://console.neon.tech/api/v2/projects/a%2Fb%3Fc%23d/roles/my%20role?search=x%26y%3Dz"
    );
    for bad in ["", ".", "..", "a\nb"] {
        assert!(http::endpoint(&base, &["projects", bad], &[]).is_err());
    }
}

#[test]
fn server_messages_never_echo_the_token() {
    let message = http::status_error(
        "PlanetScale",
        401,
        br#"{"message":"token tokid:pscale_tkn_secret is invalid"}"#,
        Some("tokid:pscale_tkn_secret"),
    )
    .message;
    assert!(!message.contains("pscale_tkn_secret"), "{message}");
    assert!(message.contains("HTTP 401"));
    let html = http::status_error("Neon", 502, b"<html>gateway</html>", None).message;
    assert!(!html.contains("<html>"));
}

#[tokio::test]
async fn redirects_are_not_followed_and_bodies_are_bounded() {
    let followed = Arc::new(AtomicUsize::new(0));
    let seen = followed.clone();
    let server = http_mock::start_with_headers(move |request| match request.route() {
        "/redirect" => (302, vec![("Location".into(), "/stolen".into())], Vec::new()),
        "/stolen" => {
            seen.fetch_add(1, Ordering::SeqCst);
            (200, Vec::new(), b"{}".to_vec())
        }
        "/big" => (200, Vec::new(), vec![b'x'; 70 * 1024]),
        _ => (404, Vec::new(), b"{}".to_vec()),
    });
    let base = http::base_url(neon::API, Some(&server.base)).unwrap();
    let auth = Auth::Bearer("secret-token".into());
    let error = http::send(
        "Neon",
        &auth,
        Method::GET,
        http::endpoint(&base, &["redirect"], &[]).unwrap(),
        Body::Empty,
        1024,
    )
    .await
    .err()
    .unwrap();
    assert_eq!(error.status, Some(302));
    assert_eq!(followed.load(Ordering::SeqCst), 0);
    let error = http::send(
        "Neon",
        &auth,
        Method::GET,
        http::endpoint(&base, &["big"], &[]).unwrap(),
        Body::Empty,
        64 * 1024,
    )
    .await
    .err()
    .unwrap();
    assert!(
        error.message.contains("größer als 64 KB"),
        "{}",
        error.message
    );
}

#[tokio::test]
async fn neon_api_key_accounts_are_verified_and_stored_in_the_backend_namespace() {
    let server = http_mock::start(|request| match request.header("authorization") {
        Some("Bearer good-key") if request.route() == "/projects" => {
            (200, bytes(json!({"projects": []})))
        }
        _ => (401, bytes(json!({"message": "invalid API key good-key"}))),
    });
    let vault = MemoryVault::default();
    let error = neon::add_api_key(&vault, "Neon", "bad-key", Some(&server.base))
        .await
        .unwrap_err();
    assert!(error.contains("401"));
    assert!(store::list(&vault).await.unwrap().is_empty());
    assert!(
        neon::add_api_key(&vault, "x", "has space", Some(&server.base))
            .await
            .is_err()
    );
    let account = neon::add_api_key(&vault, " Firma ", "good-key", Some(&server.base))
        .await
        .unwrap();
    assert_eq!(account.label, "Firma");
    assert_eq!(account.provider, Provider::Neon);
    assert_eq!(account.auth, AuthMethod::ApiKey);
    assert!(account
        .endpoint
        .as_deref()
        .unwrap()
        .starts_with("http://127.0.0.1"));
    let stored = vault.backend.lock().unwrap().clone();
    assert_eq!(
        stored.get(&format!("backend:cloud:neon:{}:credential", account.id)),
        Some(&"good-key".to_string())
    );
    assert!(!serde_json::to_string(&account)
        .unwrap()
        .contains("good-key"));
    let requests = server.requests();
    assert_eq!(requests[0].query("limit").as_deref(), Some("1"));
    let client = neon::client(&vault, &account).await.unwrap();
    assert!(client.custom);
}

#[tokio::test]
async fn neon_projects_branches_and_roles_follow_cursors_and_hide_passwords() {
    let projects: Vec<Value> = (0..250)
        .map(|i| json!({"id": format!("p-{i:03}"), "name": format!("Projekt {i}"), "region_id": "aws-eu-central-1", "pg_version": 17}))
        .collect();
    let server = http_mock::start(move |request| {
        if request.header("authorization") != Some("Bearer neon-key") {
            return (401, Vec::new());
        }
        match request.route() {
            "/projects" => {
                let start = request
                    .query("cursor")
                    .and_then(|cursor| {
                        cursor
                            .strip_prefix("p-")
                            .and_then(|n| n.parse::<usize>().ok())
                    })
                    .map(|n| n + 1)
                    .unwrap_or(0);
                let limit: usize = request.query("limit").unwrap().parse().unwrap();
                let page: Vec<Value> = projects.iter().skip(start).take(limit).cloned().collect();
                let cursor = page.last().map(|p| p["id"].clone()).unwrap_or(json!(""));
                (
                    200,
                    bytes(json!({"projects": page, "pagination": {"cursor": cursor}})),
                )
            }
            "/users/me/organizations" => (403, bytes(json!({"message": "org key"}))),
            "/projects/p-001/branches" => (
                200,
                bytes(json!({
                    "branches": [{"id": "br-main", "name": "main", "default": true, "protected": false, "current_state": "ready"}],
                    "pagination": {"next": "cursor-2"}
                })),
            ),
            "/projects/p-001/branches/br-main/roles" => (
                200,
                bytes(
                    json!({"roles": [{"name": "neondb_owner", "password": "leak", "protected": false}]}),
                ),
            ),
            "/projects/p-001/branches/br-main/databases" => (
                200,
                bytes(
                    json!({"databases": [{"id": 1, "name": "neondb", "owner_name": "neondb_owner", "branch_id": "br-main"}]}),
                ),
            ),
            _ => (404, Vec::new()),
        }
    });
    let client = neon_client(&server.base);
    assert!(client.organizations().await.unwrap().is_empty());
    let mut cursor: Option<String> = None;
    let mut seen = 0;
    let mut pages = 0;
    loop {
        let page = client
            .projects(Some("org-1"), cursor.as_deref(), Some("Projekt"))
            .await
            .unwrap();
        pages += 1;
        seen += page.items.len();
        assert!(page.items.len() <= neon::PROJECT_PAGE);
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    assert_eq!((seen, pages), (250, 3));
    let project_requests: Vec<MockRequest> = server
        .requests()
        .into_iter()
        .filter(|request| request.route() == "/projects")
        .collect();
    assert_eq!(project_requests.len(), 3);
    assert!(project_requests
        .iter()
        .all(
            |request| request.query("org_id").as_deref() == Some("org-1")
                && request.query("search").as_deref() == Some("Projekt")
        ));
    assert!(client.projects(Some("org/../x"), None, None).await.is_err());
    let branches = client.branches("p-001", None).await.unwrap();
    assert_eq!(branches.items[0].name, "main");
    assert!(branches.items[0].default);
    assert_eq!(branches.next_cursor.as_deref(), Some("cursor-2"));
    let roles = client.roles("p-001", "br-main").await.unwrap();
    assert!(!serde_json::to_string(&roles).unwrap().contains("leak"));
    let databases = client.databases("p-001", "br-main").await.unwrap();
    assert_eq!(databases[0].owner_name, "neondb_owner");
}

#[test]
fn neon_connection_urls_lose_the_password_and_keep_tls() {
    let (url, password, ssl) = neon::split_password(
        "postgresql://neondb_owner:p%40ss%2Fw@ep-cool-1.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
        neon::Transport::WebSocket,
        false,
    )
    .unwrap();
    assert_eq!(password, "p@ss/w");
    assert_eq!(ssl, "require");
    assert_eq!(
        url,
        "postgresql://neondb_owner@ep-cool-1.eu-central-1.aws.neon.tech/neondb?sslmode=require&channel_binding=disable&l8db_transport=neon-ws"
    );
    let (tcp, _, _) = neon::split_password(
        "postgresql://u:p@ep-x.neon.build/db?sslmode=verify-full&channel_binding=require",
        neon::Transport::Tcp,
        false,
    )
    .unwrap();
    assert!(
        tcp.ends_with("sslmode=verify-full&channel_binding=require"),
        "{tcp}"
    );
    let (plain, _, _) = neon::split_password(
        "postgres://u:p@ep-x.neon.tech/db?sslmode=disable",
        neon::Transport::Tcp,
        false,
    )
    .unwrap();
    assert!(plain.ends_with("?sslmode=require"), "{plain}");
    assert!(neon::split_password(
        "postgres://u:p@evil.example.com/db",
        neon::Transport::Tcp,
        false
    )
    .is_err());
    assert!(neon::split_password(
        "postgres://u@ep-x.neon.tech/db",
        neon::Transport::Tcp,
        false
    )
    .is_err());
    assert!(
        neon::split_password("mysql://u:p@ep-x.neon.tech/db", neon::Transport::Tcp, false).is_err()
    );
    assert!(neon::Transport::parse("socks").is_err());
}

#[tokio::test]
async fn neon_create_connection_stores_the_password_only_in_the_keychain() {
    let server = http_mock::start(|request| match request.route() {
        "/projects/p-1/connection_uri" => (
            200,
            bytes(
                json!({"uri": "postgresql://app:s3cr%3At@ep-a.eu-central-1.aws.neon.tech/app%20db?sslmode=require"}),
            ),
        ),
        _ => (404, Vec::new()),
    });
    let vault = MemoryVault::default();
    let request = neon::ConnectionRequest {
        project_id: "p-1".into(),
        branch_id: "br-1".into(),
        database: "app db".into(),
        role: "app".into(),
        pooled: true,
        transport: "tcp".into(),
        name: "Neon / main".into(),
    };
    let created = neon_client(&server.base)
        .create_connection(&vault, &request)
        .await
        .unwrap();
    assert_eq!(created.kind, "postgres");
    assert_eq!(created.provider_id, "neon");
    assert!(!created.connection_string.contains("s3cr"));
    assert_eq!(
        vault.connections.lock().unwrap().get(&created.id),
        Some(&"s3cr:t".to_string())
    );
    assert_eq!(created.id.len(), 36);
    let requests = server.requests();
    let sent = &requests[0];
    assert_eq!(sent.query("branch_id").as_deref(), Some("br-1"));
    assert_eq!(sent.query("database_name").as_deref(), Some("app db"));
    assert_eq!(sent.query("role_name").as_deref(), Some("app"));
    assert_eq!(sent.query("pooled").as_deref(), Some("true"));
    let mut bad = request.clone();
    bad.name = " ".into();
    assert!(neon_client(&server.base)
        .create_connection(&vault, &bad)
        .await
        .is_err());
}

#[test]
fn neon_auth_layouts_cover_better_auth_stack_and_unknown_schemas() {
    let columns = |table: &str, names: &[&str]| -> Vec<(String, String)> {
        names
            .iter()
            .map(|name| (table.to_string(), name.to_string()))
            .collect()
    };
    let better = neon::auth_layout(&columns(
        "user",
        &[
            "id",
            "name",
            "email",
            "emailVerified",
            "createdAt",
            "role",
            "banned",
        ],
    ))
    .unwrap();
    assert_eq!(better.schema, "better_auth");
    let sql = better.select_sql();
    assert!(sql.contains("FROM neon_auth.\"user\""), "{sql}");
    assert!(sql.contains("\"createdAt\" DESC NULLS LAST"), "{sql}");
    assert!(sql.contains("LIMIT 51 OFFSET $2"), "{sql}");
    let stack = neon::auth_layout(&columns(
        "users_sync",
        &[
            "raw_json",
            "id",
            "name",
            "email",
            "created_at",
            "deleted_at",
        ],
    ))
    .unwrap();
    assert_eq!(stack.schema, "stack");
    assert!(stack.select_sql().contains("\"deleted_at\" IS NULL"));
    let mut mixed = columns("account", &["id", "userId"]);
    mixed.extend(columns("member", &["id"]));
    let error = neon::auth_layout(&mixed).unwrap_err();
    assert!(error.contains("Unbekanntes Neon-Auth-Schema"), "{error}");
    assert!(error.contains("account, member"), "{error}");
    assert!(neon::auth_layout(&[]).unwrap_err().contains("keine"));
    assert_eq!(neon::like_pattern(Some("a%_\\b")), "%a\\%\\_\\\\b%");
    assert_eq!(neon::like_pattern(None), "%");
}

#[tokio::test]
async fn neon_auth_storage_and_functions_use_the_documented_endpoints() {
    let server = http_mock::start(|request| {
        let route = request.route();
        match (request.method.as_str(), route) {
            ("GET", "/projects/p-1/branches/br-off/auth") => {
                (404, bytes(json!({"message": "not enabled"})))
            }
            ("GET", "/projects/p-1/branches/br-1/auth") => (
                200,
                bytes(
                    json!({"auth_provider": "better_auth", "auth_provider_project_id": "x", "branch_id": "br-1", "db_name": "neondb", "created_at": "2026-10-01T00:00:00Z", "owned_by": "neon", "jwks_url": "https://ep.neonauth/jwks.json"}),
                ),
            ),
            ("POST", "/projects/p-1/branches/br-1/auth") => (
                201,
                bytes(
                    json!({"auth_provider": "better_auth", "auth_provider_project_id": "x", "pub_client_key": "pck", "secret_server_key": "ssk_secret", "jwks_url": "j", "schema_name": "neon_auth", "table_name": "users_sync"}),
                ),
            ),
            ("POST", "/projects/p-1/branches/br-1/auth/users") => {
                (201, bytes(json!({"id": "u-1"})))
            }
            ("DELETE", "/projects/p-1/branches/br-1/auth/users/u%201") => (200, Vec::new()),
            ("PUT", "/projects/p-1/branches/br-1/auth/users/u-1/role") => {
                (200, bytes(json!({"id": "u-1"})))
            }
            ("GET", "/projects/p-1/branches/br-1/storage") => (
                200,
                bytes(
                    json!({"enabled": true, "s3_endpoint": "https://s3.neon", "region": "eu", "force_path_style": true}),
                ),
            ),
            ("GET", "/projects/p-1/branches/br-beta/buckets") => {
                (403, bytes(json!({"message": "feature not enabled"})))
            }
            ("GET", "/projects/p-1/branches/br-1/buckets") => (
                200,
                bytes(
                    json!({"buckets": [{"name": "avatars", "access_level": "private", "created_at": "2026"}]}),
                ),
            ),
            ("POST", "/projects/p-1/branches/br-1/buckets") => (
                201,
                bytes(
                    json!({"bucket": {"name": "media", "access_level": "public_read", "created_at": "2026"}}),
                ),
            ),
            ("GET", "/projects/p-1/branches/br-1/buckets/avatars/objects") => (
                200,
                bytes(
                    json!({"folders": ["2026/"], "objects": [{"key": "a.png", "size": 10, "last_modified": "x", "etag": "e"}], "prefix": "", "next_cursor": "stale", "is_truncated": false}),
                ),
            ),
            ("GET", "/projects/p-1/branches/br-1/functions") => (
                200,
                bytes(
                    json!({"functions": [{"id": "f1", "slug": "hello", "name": "Hello", "invocation_url": "https://fn", "created_at": "x",
                    "current_deployment": {"id": 3, "status": "completed", "memory_mib": 256, "runtime": "node22", "created_at": "x", "environment": [{"name": "API_KEY", "value": "env-secret"}]}}],
                    "pagination": {"next": "f-cursor"}}),
                ),
            ),
            ("GET", "/projects/p-1/branches/br-1/functions/hello") => (
                200,
                bytes(
                    json!({"function": {"id": "f1", "slug": "hello", "name": "Hello", "invocation_url": "https://fn", "created_at": "x"}}),
                ),
            ),
            _ => (404, Vec::new()),
        }
    });
    let client = neon_client(&server.base);
    let vault = MemoryVault::default();
    let account = store::insert(
        &vault,
        store::new_account(Provider::Neon, "n".into(), AuthMethod::ApiKey, None, None),
        "neon-key",
    )
    .await
    .unwrap();
    assert!(!client.auth_state("p-1", "br-off").await.unwrap().enabled);
    let state = client.auth_state("p-1", "br-1").await.unwrap();
    assert_eq!(state.config.unwrap().db_name.as_deref(), Some("neondb"));
    assert!(client
        .auth_enable(&vault, &account, "p-1", "br-1", None, false)
        .await
        .is_err());
    let enabled = client
        .auth_enable(&vault, &account, "p-1", "br-1", Some("neondb"), true)
        .await
        .unwrap();
    assert!(enabled.stored_keys);
    assert!(!serde_json::to_string(&enabled)
        .unwrap()
        .contains("ssk_secret"));
    let keys = vault
        .backend
        .lock()
        .unwrap()
        .get(&store::secret_account(&account, neon::AUTH_KEYS))
        .cloned()
        .unwrap();
    assert!(keys.contains("ssk_secret") && keys.contains("p-1:br-1"));
    assert_eq!(
        client
            .auth_create_user("p-1", "br-1", "ada@example.com", Some("Ada"))
            .await
            .unwrap(),
        "u-1"
    );
    assert!(client
        .auth_create_user("p-1", "br-1", "kein-at", None)
        .await
        .is_err());
    assert!(client
        .auth_delete_user("p-1", "br-1", "u 1", false)
        .await
        .is_err());
    client
        .auth_delete_user("p-1", "br-1", "u 1", true)
        .await
        .unwrap();
    client
        .auth_set_roles("p-1", "br-1", "u-1", &["admin".into()])
        .await
        .unwrap();
    assert!(client
        .auth_set_roles("p-1", "br-1", "u-1", &[])
        .await
        .is_err());
    assert!(client.storage("p-1", "br-1").await.unwrap().enabled);
    let beta = client.buckets("p-1", "br-beta").await.unwrap_err();
    assert!(beta.contains("Neon Storage ist für dieses Konto"), "{beta}");
    assert_eq!(
        client.buckets("p-1", "br-1").await.unwrap()[0].name,
        "avatars"
    );
    assert!(client
        .create_bucket("p-1", "br-1", "Bad_Name", false)
        .await
        .is_err());
    assert_eq!(
        client
            .create_bucket("p-1", "br-1", "media", true)
            .await
            .unwrap()
            .access_level
            .as_deref(),
        Some("public_read")
    );
    let objects = client
        .objects("p-1", "br-1", "avatars", Some("2026/"), Some("c-1"))
        .await
        .unwrap();
    assert_eq!(objects.next_cursor, None);
    assert_eq!(objects.objects[0].key, "a.png");
    let functions = client.functions("p-1", "br-1", None).await.unwrap();
    assert_eq!(functions.next_cursor.as_deref(), Some("f-cursor"));
    assert!(!serde_json::to_string(&functions)
        .unwrap()
        .contains("env-secret"));
    assert_eq!(
        client.function("p-1", "br-1", "hello").await.unwrap().slug,
        "hello"
    );
    let requests = server.requests();
    let find = |method: &str, route: &str| {
        requests
            .iter()
            .find(|request| request.method == method && request.route() == route)
            .cloned()
            .unwrap()
    };
    assert_eq!(
        find("POST", "/projects/p-1/branches/br-1/auth").json(),
        json!({"auth_provider": "better_auth", "database_name": "neondb"})
    );
    assert_eq!(
        find("POST", "/projects/p-1/branches/br-1/auth/users").json(),
        json!({"email": "ada@example.com", "name": "Ada"})
    );
    assert_eq!(
        find("PUT", "/projects/p-1/branches/br-1/auth/users/u-1/role").json(),
        json!({"roles": ["admin"]})
    );
    assert_eq!(
        find("POST", "/projects/p-1/branches/br-1/buckets").json(),
        json!({"name": "media", "access_level": "public_read"})
    );
    let listing = find("GET", "/projects/p-1/branches/br-1/buckets/avatars/objects");
    assert_eq!(listing.query("prefix").as_deref(), Some("2026/"));
    assert_eq!(listing.query("cursor").as_deref(), Some("c-1"));
    assert_eq!(listing.query("delimiter").as_deref(), Some("/"));
    assert_eq!(listing.query("limit").as_deref(), Some("100"));
    assert!(requests
        .iter()
        .all(|request| request.header("authorization") == Some("Bearer neon-key")));
}

#[test]
fn oauth_needs_an_own_client_and_validates_callbacks() {
    assert_eq!(oauth::config_from(None, None, None, None).unwrap(), None);
    assert!(oauth::config_from(Some("neonctl".into()), None, None, None).is_err());
    assert!(oauth::config_from(Some("id".into()), None, Some("x".into()), None).is_err());
    let config = oauth::config_from(Some("l8db".into()), None, Some("53682".into()), None)
        .unwrap()
        .unwrap();
    assert_eq!(config.redirect_port, 53682);
    assert_eq!(config.authorize_url.as_str(), oauth::AUTHORIZE_URL);
    let unavailable = oauth::availability(Ok(None));
    assert!(!unavailable.available);
    assert!(unavailable.reason.unwrap().contains("API-Schlüssel"));
    let head = |target: &str| format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n");
    assert_eq!(
        oauth::parse_callback(&head("/callback?code=abc&state=s1"), "s1"),
        (200, oauth::CallbackOutcome::Code("abc".into()))
    );
    assert_eq!(
        oauth::parse_callback(&head("/callback?code=abc&state=s2"), "s1").1,
        oauth::CallbackOutcome::Ignored
    );
    assert_eq!(
        oauth::parse_callback(&head("/other?code=abc&state=s1"), "s1").0,
        404
    );
    assert!(matches!(
        oauth::parse_callback(&head("/callback?error=access_denied&state=s1"), "s1").1,
        oauth::CallbackOutcome::Denied(_)
    ));
    assert_eq!(
        oauth::parse_callback("POST /callback?code=a&state=s1 HTTP/1.1\r\n\r\n", "s1").0,
        405
    );
    assert_eq!(
        oauth::challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
}

fn test_config(base: &str) -> oauth::OAuthConfig {
    oauth::OAuthConfig {
        client_id: "l8db-test".into(),
        client_secret: None,
        authorize_url: url::Url::parse(&format!("{base}/oauth2/auth")).unwrap(),
        token_url: url::Url::parse(&format!("{base}/oauth2/token")).unwrap(),
        redirect_port: 0,
        scopes: "openid offline".into(),
    }
}

fn browser() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

#[tokio::test]
async fn oauth_pkce_flow_cancel_timeout_and_refresh_rotation() {
    let refreshes = Arc::new(AtomicUsize::new(0));
    let counter = refreshes.clone();
    let server = http_mock::start(move |request| {
        match (request.method.as_str(), request.route()) {
            ("POST", "/oauth2/token") => match request.form("grant_type").as_deref() {
                Some("authorization_code")
                    if request.form("code").as_deref() == Some("the-code") =>
                {
                    (
                        200,
                        bytes(
                            json!({"access_token": "access-1", "refresh_token": "refresh-1", "expires_in": 3600, "token_type": "bearer"}),
                        ),
                    )
                }
                Some("refresh_token")
                    if request.form("refresh_token").as_deref() == Some("refresh-1") =>
                {
                    counter.fetch_add(1, Ordering::SeqCst);
                    std::thread::sleep(Duration::from_millis(50));
                    (
                        200,
                        bytes(
                            json!({"access_token": "access-2", "refresh_token": "refresh-2", "expires_in": 3600}),
                        ),
                    )
                }
                _ => (400, bytes(json!({"error": "invalid_grant"}))),
            },
            ("GET", "/projects") if request.header("authorization") == Some("Bearer access-1") => {
                (200, bytes(json!({"projects": []})))
            }
            _ => (401, Vec::new()),
        }
    });
    let vault = MemoryVault::default();
    let started = oauth::start(test_config(&server.base), "OAuth-Konto")
        .await
        .unwrap();
    let authorize = url::Url::parse(&started.authorize_url).unwrap();
    let param = |name: &str| {
        authorize
            .query_pairs()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.into_owned())
            .unwrap()
    };
    assert_eq!(param("client_id"), "l8db-test");
    assert_eq!(param("code_challenge_method"), "S256");
    assert_eq!(param("response_type"), "code");
    let redirect = param("redirect_uri");
    assert!(redirect.starts_with("http://127.0.0.1:") && redirect.ends_with("/callback"));
    let forged = browser()
        .get(format!("{redirect}?code=evil&state=wrong"))
        .send()
        .await
        .unwrap();
    assert_eq!(forged.status().as_u16(), 400);
    let callback = browser()
        .get(format!("{redirect}?code=the-code&state={}", param("state")))
        .send()
        .await
        .unwrap();
    assert_eq!(callback.status().as_u16(), 200);
    let account = oauth::finish_with(
        &vault,
        &started.flow_id,
        http::base_url(neon::API, Some(&server.base)).unwrap(),
    )
    .await
    .unwrap();
    assert_eq!(account.auth, AuthMethod::Oauth);
    let exchange = server
        .requests()
        .into_iter()
        .find(|request| request.form("grant_type").as_deref() == Some("authorization_code"))
        .unwrap();
    assert_eq!(
        oauth::challenge(&exchange.form("code_verifier").unwrap()),
        param("code_challenge")
    );
    assert_eq!(
        exchange.form("redirect_uri").as_deref(),
        Some(redirect.as_str())
    );
    assert_eq!(exchange.form("client_id").as_deref(), Some("l8db-test"));
    assert!(oauth::finish_with(
        &vault,
        &started.flow_id,
        http::base_url(neon::API, None).unwrap()
    )
    .await
    .is_err());

    let second = oauth::start(test_config(&server.base), "Abbruch")
        .await
        .unwrap();
    let second_redirect = url::Url::parse(&second.authorize_url)
        .unwrap()
        .query_pairs()
        .find(|(key, _)| key == "redirect_uri")
        .map(|(_, value)| value.into_owned())
        .unwrap();
    assert!(oauth::cancel(&second.flow_id));
    assert!(!oauth::cancel(&second.flow_id));
    assert!(oauth::finish_with(
        &vault,
        &second.flow_id,
        http::base_url(neon::API, None).unwrap()
    )
    .await
    .is_err());
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(browser().get(second_redirect).send().await.is_err());

    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let timeout = oauth::serve_callback(
        listener,
        "s".into(),
        tokio_util::sync::CancellationToken::new(),
        Duration::from_millis(50),
    )
    .await
    .unwrap_err();
    assert!(timeout.contains("Zeitüberschreitung"));

    let expired = serde_json::to_string(&oauth::Tokens {
        access_token: "access-1".into(),
        refresh_token: Some("refresh-1".into()),
        expires_at: chrono::Utc::now().timestamp() - 5,
    })
    .unwrap();
    store::update_credential(&vault, &account, &expired)
        .await
        .unwrap();
    let config = test_config(&server.base);
    let (first, second) = tokio::join!(
        oauth::access_token_with(&vault, &account, Some(&config)),
        oauth::access_token_with(&vault, &account, Some(&config))
    );
    assert_eq!(first.unwrap(), "access-2");
    assert_eq!(second.unwrap(), "access-2");
    assert_eq!(refreshes.load(Ordering::SeqCst), 1);
    let rotated: oauth::Tokens =
        serde_json::from_str(&store::credential(&vault, &account).await.unwrap()).unwrap();
    assert_eq!(rotated.refresh_token.as_deref(), Some("refresh-2"));
    let stale = serde_json::to_string(&oauth::Tokens {
        expires_at: 0,
        ..rotated
    })
    .unwrap();
    store::update_credential(&vault, &account, &stale)
        .await
        .unwrap();
    let error = oauth::access_token_with(&vault, &account, Some(&config))
        .await
        .unwrap_err();
    assert!(error.contains("abgelaufen"), "{error}");
    assert!(oauth::access_token_with(&vault, &account, None)
        .await
        .is_err());
}

#[tokio::test]
async fn planetscale_service_tokens_paginate_and_issue_tracked_reader_credentials() {
    let deletes = Arc::new(Mutex::new(Vec::<String>::new()));
    let deleted = deletes.clone();
    let server = http_mock::start(move |request| {
        if request.header("authorization") != Some("tokid:pscale_tkn_secret") {
            return (401, bytes(json!({"message": "bad token"})));
        }
        let route = request.route().to_string();
        match (request.method.as_str(), route.as_str()) {
            ("GET", "/organizations") => {
                let page: i64 = request
                    .query("page")
                    .and_then(|p| p.parse().ok())
                    .unwrap_or(1);
                let next = if page < 3 {
                    json!(page + 1)
                } else {
                    Value::Null
                };
                (
                    200,
                    bytes(
                        json!({"type": "list", "current_page": page, "next_page": next, "data": [{"id": format!("o{page}"), "name": format!("org-{page}")}]}),
                    ),
                )
            }
            ("GET", "/organizations/acme/databases") => (
                200,
                bytes(
                    json!({"data": [{"id": "d1", "name": "app", "kind": "mysql", "state": "ready", "ready": true, "region": {"slug": "eu-west"}}, {"id": "d2", "name": "pgapp", "kind": "postgresql", "ready": true}], "next_page": null}),
                ),
            ),
            ("GET", "/organizations/acme/databases/app/branches") => (
                200,
                bytes(
                    json!({"data": [{"id": "b1", "name": "main", "production": true, "ready": true}], "next_page": null}),
                ),
            ),
            ("GET", "/organizations/acme/databases/app") => {
                (200, bytes(json!({"name": "app", "kind": "mysql"})))
            }
            ("GET", "/organizations/acme/databases/pgapp") => {
                (200, bytes(json!({"name": "pgapp", "kind": "postgresql"})))
            }
            ("GET", "/organizations/acme/databases/broken") => {
                (200, bytes(json!({"name": "broken", "kind": "postgresql"})))
            }
            ("GET", "/organizations/acme/databases/neki") => {
                (200, bytes(json!({"name": "neki", "kind": "neki"})))
            }
            ("POST", "/organizations/acme/databases/app/branches/main/passwords") => (
                201,
                bytes(
                    json!({"id": "pw1", "name": "l8db-ro", "role": "reader", "username": "u1", "plain_text": "pscale_pw_x", "access_host_url": "aws.connect.psdb.cloud"}),
                ),
            ),
            ("POST", "/organizations/acme/databases/pgapp/branches/main/roles") => (
                200,
                bytes(
                    json!({"id": "r1", "name": "l8db-ro", "username": "pscale_api_x.abc", "password": "pgpw", "access_host_url": "aws-eu-central-1-1.pg.psdb.cloud", "database_name": "postgres"}),
                ),
            ),
            ("POST", "/organizations/acme/databases/broken/branches/main/roles") => (
                200,
                bytes(
                    json!({"id": "r9", "name": "x", "username": "u", "password": null, "access_host_url": "h.pg.psdb.cloud"}),
                ),
            ),
            ("DELETE", path) => {
                deleted.lock().unwrap().push(path.to_string());
                if path.ends_with("/gone") {
                    (404, Vec::new())
                } else {
                    (204, Vec::new())
                }
            }
            _ => (404, Vec::new()),
        }
    });
    let vault = MemoryVault::default();
    assert!(
        planetscale::add_token(&vault, "PS", "tokid", "wrong", Some(&server.base))
            .await
            .is_err()
    );
    let account = planetscale::add_token(
        &vault,
        "PS",
        "tokid",
        "pscale_tkn_secret",
        Some(&server.base),
    )
    .await
    .unwrap();
    assert_eq!(account.auth, AuthMethod::ServiceToken);
    let client = planetscale::client(&vault, &account).await.unwrap();
    let mut page = None;
    let mut names = Vec::new();
    loop {
        let result = client.organizations(page).await.unwrap();
        names.extend(result.items.into_iter().map(|org| org.name));
        match result.next_page {
            Some(next) => page = Some(next),
            None => break,
        }
    }
    assert_eq!(names, vec!["org-1", "org-2", "org-3"]);
    assert!(server
        .requests()
        .iter()
        .filter(|request| request.route() == "/organizations" && request.query("page").is_some())
        .all(|request| request.query("per_page").as_deref() == Some("50")));
    assert!(client.organizations(Some(0)).await.is_err());
    let databases = client.databases("acme", None).await.unwrap();
    assert_eq!(databases.items[1].kind, "postgresql");
    assert_eq!(
        client.branches("acme", "app", None).await.unwrap().items[0].name,
        "main"
    );

    let request = |database: &str, confirmed: bool| planetscale::CredentialRequest {
        organization: "acme".into(),
        database: database.into(),
        branch: "main".into(),
        credential_name: Some("l8db-ro".into()),
        connection_name: format!("PlanetScale {database}"),
        confirmed,
    };
    assert!(client
        .create_credential(&vault, &account, &request("app", false))
        .await
        .is_err());
    let mysql = client
        .create_credential(&vault, &account, &request("app", true))
        .await
        .unwrap();
    assert_eq!(
        mysql.connection.connection_string,
        "mysql://u1@aws.connect.psdb.cloud:3306/app?ssl-mode=required"
    );
    assert_eq!(mysql.connection.kind, "mysql");
    assert_eq!(
        vault.connections.lock().unwrap().get(&mysql.connection.id),
        Some(&"pscale_pw_x".to_string())
    );
    assert_eq!(mysql.credential.connection_id, mysql.connection.id);
    let posted = server
        .requests()
        .into_iter()
        .find(|request| request.method == "POST" && request.route().ends_with("/passwords"))
        .unwrap();
    assert_eq!(posted.json(), json!({"name": "l8db-ro", "role": "reader"}));
    let pg = client
        .create_credential(&vault, &account, &request("pgapp", true))
        .await
        .unwrap();
    assert_eq!(
        pg.connection.connection_string,
        "postgresql://pscale_api_x.abc@aws-eu-central-1-1.pg.psdb.cloud:5432/postgres?sslmode=require"
    );
    assert_eq!(pg.connection.kind, "postgres");
    let role_body = server
        .requests()
        .into_iter()
        .find(|request| request.method == "POST" && request.route().ends_with("/roles"))
        .unwrap()
        .json();
    assert_eq!(role_body["inherited_roles"], json!(["pg_read_all_data"]));
    let broken = client
        .create_credential(&vault, &account, &request("broken", true))
        .await
        .unwrap_err();
    assert!(broken.contains("kein Passwort"), "{broken}");
    assert!(deletes
        .lock()
        .unwrap()
        .contains(&"/organizations/acme/databases/broken/branches/main/roles/r9".to_string()));
    assert!(client
        .create_credential(&vault, &account, &request("neki", true))
        .await
        .is_err());
    assert_eq!(
        planetscale::issued(&vault, &account).await.unwrap().len(),
        2
    );

    assert!(client.revoke(&vault, &account, "pw1", false).await.is_err());
    assert!(client
        .revoke(&vault, &account, "not-ours", true)
        .await
        .is_err());
    let remaining = client.revoke(&vault, &account, "pw1", true).await.unwrap();
    assert_eq!(remaining.len(), 1);
    assert!(deletes
        .lock()
        .unwrap()
        .contains(&"/organizations/acme/databases/app/branches/main/passwords/pw1".to_string()));
    let removal = super::remove_account(&vault, &account.id, false)
        .await
        .unwrap_err();
    assert!(removal.contains("1 von l8db"), "{removal}");
    super::remove_account(&vault, &account.id, true)
        .await
        .unwrap();
    assert!(vault
        .backend
        .lock()
        .unwrap()
        .keys()
        .all(|key| !key.contains(&account.id)));
    assert_eq!(vault.connections.lock().unwrap().len(), 2);
}

#[test]
fn planetscale_hosts_and_names_are_validated() {
    assert_eq!(
        planetscale::split_host("aws.connect.psdb.cloud", 3306, false).unwrap(),
        ("aws.connect.psdb.cloud".into(), 3306, None)
    );
    assert_eq!(
        planetscale::split_host("postgresql://h.pg.psdb.cloud:6432/db", 5432, false).unwrap(),
        ("h.pg.psdb.cloud".into(), 6432, Some("db".into()))
    );
    assert!(planetscale::split_host("evil.example.com", 3306, false).is_err());
    assert!(planetscale::split_host("evil.example.com", 3306, true).is_ok());
    assert!(planetscale::credential_name(Some("bad name")).is_err());
    assert!(planetscale::credential_name(None)
        .unwrap()
        .starts_with("l8db-"));
    assert!(planetscale::validate_token_parts("id:x", "t").is_err());
    assert!(planetscale::validate_token_parts("id", "").is_err());
}

fn spacetime_token(identity: &str) -> String {
    let encode =
        |value: Value| base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(value.to_string());
    format!(
        "{}.{}.signature",
        encode(json!({"alg": "ES256"})),
        encode(json!({"hex_identity": identity, "sub": "x", "iss": "localhost"}))
    )
}

#[tokio::test]
async fn spacetime_accounts_list_databases_with_bounded_concurrency_and_confirm_reducers() {
    let identity = "ab".repeat(32);
    let token = spacetime_token(&identity);
    let inflight = Arc::new(AtomicUsize::new(0));
    let peak = Arc::new(AtomicUsize::new(0));
    let (now, max) = (inflight.clone(), peak.clone());
    let expected = format!("Bearer {token}");
    let verify_path = format!("/v1/identity/{identity}/verify");
    let list_path = format!("/v1/identity/{identity}/databases");
    let schema = json!({
        "typespace": {"types": [{"Product": {"elements": [{"name": {"some": "nick"}, "algebraic_type": {"String": []}}]}}]},
        "tables": [{"name": "player", "product_type_ref": 0, "primary_key": [], "table_type": {"User": []}, "table_access": {"Public": []}}],
        "reducers": [
            {"name": "set_nick", "params": {"elements": [{"name": {"some": "nick"}, "algebraic_type": {"String": []}}]}, "lifecycle": {"none": []}},
            {"name": "init", "params": {"elements": []}, "lifecycle": {"some": {"Init": []}}}
        ]
    });
    let server = http_mock::start(move |request| {
        if request.header("authorization") != Some(expected.as_str()) {
            return (401, Vec::new());
        }
        let route = request.route().to_string();
        if route == verify_path {
            return (204, Vec::new());
        }
        if route == list_path {
            let ids: Vec<String> = (0..150).map(|i| format!("{i:064x}")).collect();
            return (200, bytes(json!({"identities": ids})));
        }
        if route.ends_with("/names") {
            let current = now.fetch_add(1, Ordering::SeqCst) + 1;
            max.fetch_max(current, Ordering::SeqCst);
            std::thread::sleep(Duration::from_millis(15));
            now.fetch_sub(1, Ordering::SeqCst);
            return (200, bytes(json!({"names": ["spiel"]})));
        }
        match (request.method.as_str(), route.as_str()) {
            ("GET", "/v1/database/spiel/schema") => (200, bytes(schema.clone())),
            ("GET", "/v1/database/spiel") => (200, bytes(json!({"database_identity": "c0ffee"}))),
            ("POST", "/v1/database/spiel/call/set_nick") => (200, Vec::new()),
            _ => (404, Vec::new()),
        }
    });
    let vault = MemoryVault::default();
    assert!(spacetime::token_identity("kein.jwt", None).is_err());
    let no_claim = format!(
        "e30.{}.sig",
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(r#"{"sub":"x"}"#)
    );
    assert!(spacetime::token_identity(&no_claim, None).is_err());
    assert_eq!(
        spacetime::token_identity(&no_claim, Some(&format!("0x{}", "EF".repeat(32)))).unwrap(),
        "ef".repeat(32)
    );
    assert!(spacetime::token_identity(&token, Some(&"cd".repeat(32))).is_err());
    assert!(spacetime::add(
        &vault,
        "S",
        &spacetime_token(&"cd".repeat(32)),
        Some(&server.base),
        None
    )
    .await
    .is_err());
    let account = spacetime::add(&vault, "Spiel", &token, Some(&server.base), None)
        .await
        .unwrap();
    assert_eq!(account.identity.as_deref(), Some(identity.as_str()));
    let base = http::base_url(crate::db::spacetimedb::MAINCLOUD, Some(&server.base)).unwrap();
    let started = Instant::now();
    let list = spacetime::databases_at(&base, &identity, &token)
        .await
        .unwrap();
    let elapsed = started.elapsed();
    assert_eq!(list.databases.len(), spacetime::MAX_DATABASES);
    assert!(list.truncated);
    assert_eq!(list.databases[0].names, vec!["spiel".to_string()]);
    assert!(
        peak.load(Ordering::SeqCst) <= 4,
        "{}",
        peak.load(Ordering::SeqCst)
    );
    let names_requests = server
        .requests()
        .iter()
        .filter(|request| request.route().ends_with("/names"))
        .count();
    assert_eq!(names_requests, spacetime::MAX_DATABASES);
    println!(
        "spacetime databases: 150 listed, {} names requests, peak concurrency {}, {:?}",
        names_requests,
        peak.load(Ordering::SeqCst),
        elapsed
    );
    let created = spacetime::create_connection_at(&vault, &base, &token, "spiel", "Spiel lokal")
        .await
        .unwrap();
    assert_eq!(created.kind, "spacetimedb");
    assert_eq!(created.ssl_mode, "disable");
    assert!(created
        .connection_string
        .starts_with("spacetimedb://token@127.0.0.1:"));
    assert!(created.connection_string.ends_with("/spiel?tls=false"));
    assert!(!created.connection_string.contains(&token));
    assert_eq!(
        vault.connections.lock().unwrap().get(&created.id),
        Some(&token)
    );
    let target = spacetime::target(&base, "spiel", &token).unwrap();
    assert!(
        spacetime::call_reducer_at(&target, "set_nick", &json!(["neo"]), false)
            .await
            .is_err()
    );
    assert!(
        spacetime::call_reducer_at(&target, "set_nick", &json!([]), true)
            .await
            .unwrap_err()
            .contains("erwartet 1")
    );
    assert!(
        spacetime::call_reducer_at(&target, "init", &json!([]), true)
            .await
            .is_err()
    );
    assert!(
        spacetime::call_reducer_at(&target, "set_nick", &json!({"nick": "x"}), true)
            .await
            .is_err()
    );
    let outcome = spacetime::call_reducer_at(&target, "set_nick", &json!(["neo"]), true)
        .await
        .unwrap();
    assert_eq!(outcome.status, 200);
    let calls: Vec<MockRequest> = server
        .requests()
        .into_iter()
        .filter(|request| request.route().contains("/call/"))
        .collect();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].json(), json!(["neo"]));
}

#[tokio::test]
async fn perf_neon_project_paging_and_spacetime_rows_stay_bounded() {
    let total = 5_000usize;
    let server = http_mock::start(move |request| {
        let start: usize = request
            .query("cursor")
            .and_then(|cursor| cursor.parse().ok())
            .unwrap_or(0);
        let limit: usize = request
            .query("limit")
            .and_then(|l| l.parse().ok())
            .unwrap_or(0);
        let page: Vec<Value> = (start..(start + limit).min(total))
            .map(|i| json!({"id": format!("p{i}"), "name": format!("Projekt mit längerem Namen {i}"), "region_id": "aws-eu-central-1", "pg_version": 17, "org_id": "org", "created_at": "2026-11-01T00:00:00Z"}))
            .collect();
        let next = (start + page.len()).to_string();
        (
            200,
            bytes(json!({"projects": page, "pagination": {"cursor": next}})),
        )
    });
    let client = neon_client(&server.base);
    let mut samples = Vec::new();
    let mut cursor: Option<String> = None;
    let mut seen = 0;
    loop {
        let started = Instant::now();
        let page = client
            .projects(None, cursor.as_deref(), None)
            .await
            .unwrap();
        samples.push(started.elapsed());
        assert!(page.items.len() <= neon::PROJECT_PAGE);
        seen += page.items.len();
        match page.next_cursor {
            Some(next) => cursor = Some(next),
            None => break,
        }
    }
    let requests = server.requests().len();
    assert_eq!(seen, total);
    assert_eq!(requests, total / neon::PROJECT_PAGE + 1);
    let median = percentile(&mut samples, 0.5);
    let p95 = percentile(&mut samples, 0.95);
    println!(
        "neon projects: {total} projects, {requests} requests, median {median:?}, p95 {p95:?}"
    );
    assert!(median < Duration::from_millis(60), "{median:?}");
    assert!(p95 < Duration::from_millis(200), "{p95:?}");
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(server.requests().len(), requests);

    let rows: Vec<Value> = (0..crate::db::spacetimedb::MAX_ROWS)
        .map(|i| json!([i, ["0x0102"], {"some": format!("spieler-{i}")}, 123_456_789_012_345_678u64 + i as u64]))
        .collect();
    let body = bytes(json!([{
        "schema": {"elements": [
            {"name": {"some": "id"}, "algebraic_type": {"U64": []}},
            {"name": {"some": "owner"}, "algebraic_type": {"Product": {"elements": [{"name": {"some": "__identity__"}, "algebraic_type": {"U256": []}}]}}},
            {"name": {"some": "nick"}, "algebraic_type": {"Sum": {"variants": [
                {"name": {"some": "some"}, "algebraic_type": {"String": []}},
                {"name": {"some": "none"}, "algebraic_type": {"Product": {"elements": []}}}
            ]}}},
            {"name": {"some": "score"}, "algebraic_type": {"U128": []}}
        ]},
        "rows": rows
    }]));
    let size = body.len();
    let mut parse = Vec::new();
    for _ in 0..15 {
        let started = Instant::now();
        let statements = crate::db::spacetimedb::parse_statements(
            crate::db::spacetimedb::parse_json(&body).unwrap(),
        )
        .unwrap();
        parse.push(started.elapsed());
        assert_eq!(statements[0].rows.len(), crate::db::spacetimedb::MAX_ROWS);
        assert_eq!(statements[0].rows[1][3], json!("123456789012345679"));
    }
    let median = percentile(&mut parse, 0.5);
    let p95 = percentile(&mut parse, 0.95);
    println!(
        "spacetime rows: {} rows, {} KB, median {median:?}, p95 {p95:?}",
        crate::db::spacetimedb::MAX_ROWS,
        size / 1024
    );
    assert!(median < Duration::from_millis(400), "{median:?}");
    assert!(p95 < Duration::from_millis(800), "{p95:?}");
}

#[tokio::test]
async fn accounts_index_is_bounded_and_removal_keeps_connection_passwords() {
    let vault = MemoryVault::default();
    vault
        .set_connection_secret("connection-1", "db-password")
        .await
        .unwrap();
    let mut ids = Vec::new();
    for index in 0..50 {
        let account = store::insert(
            &vault,
            store::new_account(
                Provider::Spacetimedb,
                format!("Konto {index}"),
                AuthMethod::Token,
                None,
                Some("ab".repeat(32)),
            ),
            "token",
        )
        .await
        .unwrap();
        ids.push(account.id);
    }
    assert!(store::insert(
        &vault,
        store::new_account(
            Provider::Neon,
            "zu viel".into(),
            AuthMethod::ApiKey,
            None,
            None
        ),
        "k",
    )
    .await
    .is_err());
    assert!(store::clean_label(&"x".repeat(81), "f").is_err());
    super::remove_account(&vault, &ids[0], false).await.unwrap();
    assert_eq!(store::list(&vault).await.unwrap().len(), 49);
    assert!(super::remove_account(&vault, &ids[0], false).await.is_err());
    assert_eq!(
        vault.connections.lock().unwrap().get("connection-1"),
        Some(&"db-password".to_string())
    );
    assert!(store::find_for(&vault, &ids[1], Provider::Neon)
        .await
        .is_err());
}
