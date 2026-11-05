use super::*;
use std::net::SocketAddr;

static LIFECYCLE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

fn neon_url() -> &'static str {
    "postgresql://alice:p%40ss@ep-test.eu-central-1.aws.neon.tech/app?sslmode=require&l8db_transport=neon-ws"
}

#[test]
fn validates_neon_transport_hosts_security_options_and_unknown_values() {
    let target = target(&url::Url::parse(neon_url()).unwrap())
        .unwrap()
        .unwrap();
    assert_eq!(target.url, "wss://ep-test.eu-central-1.aws.neon.tech/v2");
    assert!(!target.url.contains("alice"));
    assert!(!target.url.contains("p%40ss"));
    assert!(
        super::target(&url::Url::parse("postgresql://user@localhost/db").unwrap())
            .unwrap()
            .is_none()
    );
    for value in [
        "postgresql://user@localhost/db?l8db_transport=neon-ws",
        "postgresql://user@ep-test.neon.tech.evil.example/db?l8db_transport=neon-ws",
        "postgresql://user@neon.tech/db?l8db_transport=neon-ws",
        "postgresql://user@ep-test.neon.tech:2222/db?l8db_transport=neon-ws",
        "postgresql://user@ep-test.neon.tech/db?l8db_transport=tcp",
        "postgresql://user@ep-test.neon.tech/db?l8db_transport=neon-ws&l8db_transport=neon-ws",
        "postgresql://user@ep-test.neon.tech/db?l8db_transport=neon-ws&hostaddr=127.0.0.1",
        "postgresql://user@ep-test.neon.tech/db?l8db_transport=neon-ws&host=other",
        "postgresql://user@ep-test.neon.tech/db?l8db_transport=neon-ws&sslrootcert=/tmp/root.pem",
        "postgresql://user@ep-test.neon.tech/db?l8db_transport=neon-ws&sslcert=/tmp/client.pem",
        "postgresql://user@ep-test.neon.tech/db?l8db_transport=neon-ws&sslkey=/tmp/key.pem",
        "postgresql://user@ep-test.neon.tech/db?l8db_transport=neon-ws&channel_binding=require",
        "postgresql://user@ep-test.neon.tech/db?l8db_transport=neon-ws&sslnegotiation=direct",
        "https://ep-test.neon.tech/db?l8db_transport=neon-ws",
    ] {
        assert!(
            super::target(&url::Url::parse(value).unwrap()).is_err(),
            "{value}"
        );
    }
}

#[test]
fn inner_url_preserves_identity_and_options_but_disables_only_inner_tls() {
    let mut parsed = url::Url::parse(neon_url()).unwrap();
    parsed
        .query_pairs_mut()
        .append_pair("options", "-c default_transaction_read_only=on")
        .append_pair("schema", "Case Sensitive")
        .append_pair("proxy_user", "reporting");
    let rewritten = rewrite_with_port(parsed, 15432).unwrap();
    let parsed = super::super::connection::parse_pg_url(&rewritten).unwrap();
    assert_eq!(parsed.config.get_password(), Some(b"p@ss".as_slice()));
    assert_eq!(parsed.config.get_user(), Some("alice"));
    assert_eq!(parsed.config.get_dbname(), Some("app"));
    assert_eq!(parsed.config.get_ports(), [15432]);
    assert_eq!(
        parsed.config.get_hosts(),
        [tokio_postgres::config::Host::Tcp("127.0.0.1".into())]
    );
    assert_eq!(parsed.tls.mode, super::super::SslMode::Disable);
    assert_eq!(parsed.schema.as_deref(), Some("Case Sensitive"));
    assert_eq!(parsed.role.as_deref(), Some("reporting"));
    assert!(super::super::connection::options_are_read_only(
        parsed.config.get_options()
    ));
    let identity = super::super::connection::endpoint(neon_url()).unwrap();
    assert_eq!(identity.transport, "neon-ws");
    assert!(identity.tls && identity.verify);
    assert_eq!(identity.host, "ep-test.eu-central-1.aws.neon.tech");
    assert!(super::super::connection::parse_pg_url(
        "postgresql://u@ep-test.neon.tech/db?l8db_transport=unsupported"
    )
    .is_err());
}

struct Proxy {
    target: Target,
    cancel: CancellationToken,
    connections: Arc<AtomicU64>,
}

impl Drop for Proxy {
    fn drop(&mut self) {
        self.cancel.cancel();
    }
}

async fn proxy(destination: Option<SocketAddr>) -> Proxy {
    let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let address = listener.local_addr().unwrap();
    let cancel = CancellationToken::new();
    let stopping = cancel.clone();
    let connections = Arc::new(AtomicU64::new(0));
    let count = connections.clone();
    tokio::spawn(async move {
        loop {
            let stream = tokio::select! { _ = stopping.cancelled() => break, accepted = listener.accept() => accepted.unwrap().0 };
            count.fetch_add(1, Ordering::Relaxed);
            let stopping = stopping.clone();
            tokio::spawn(async move {
                let callback = |request: &tokio_tungstenite::tungstenite::handshake::server::Request, response: tokio_tungstenite::tungstenite::handshake::server::Response| {
                    assert_eq!(request.uri().path(), "/v2");
                    Ok(response)
                };
                let websocket = tokio_tungstenite::accept_hdr_async_with_config(
                    stream,
                    callback,
                    Some(websocket_config()),
                )
                .await
                .unwrap();
                let (mut sender, mut receiver) = websocket.split();
                if let Some(destination) = destination {
                    let tcp = TcpStream::connect(destination).await.unwrap();
                    let (mut read, mut write) = tcp.into_split();
                    let upstream = async {
                        while let Some(message) = receiver.next().await {
                            match message.map_err(|_| ())? {
                                Message::Binary(bytes) => {
                                    write.write_all(&bytes).await.map_err(|_| ())?
                                }
                                Message::Close(_) => break,
                                _ => {}
                            }
                        }
                        Ok::<_, ()>(())
                    };
                    let downstream = async {
                        let mut buffer = vec![0; CHUNK];
                        loop {
                            let count = read.read(&mut buffer).await.map_err(|_| ())?;
                            if count == 0 {
                                break;
                            }
                            sender
                                .send(Message::Binary(buffer[..count].to_vec().into()))
                                .await
                                .map_err(|_| ())?;
                        }
                        Ok::<_, ()>(())
                    };
                    tokio::select! { _ = stopping.cancelled() => {}, _ = upstream => {}, _ = downstream => {} }
                } else {
                    loop {
                        let message = tokio::select! { _ = stopping.cancelled() => break, message = receiver.next() => message };
                        let Some(Ok(Message::Binary(bytes))) = message else {
                            break;
                        };
                        if sender.send(Message::Binary(bytes)).await.is_err() {
                            break;
                        }
                    }
                }
            });
        }
    });
    Proxy {
        target: test_target(&format!("ws://{address}/v2")),
        cancel,
        connections,
    }
}

async fn stop(target: &Target) {
    let state = listeners().lock().unwrap().get(&target.url).cloned();
    if let Some(state) = state {
        state.cancel.cancel();
    }
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if !listeners().lock().unwrap().contains_key(&target.url) {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}

#[tokio::test]
async fn loopback_proxy_reuses_listeners_backs_off_and_retires_idle_without_polling() {
    let _guard = LIFECYCLE.lock().await;
    let proxy = proxy(None).await;
    let state = ensure(&proxy.target).unwrap();
    assert!(Arc::ptr_eq(&state, &ensure(&proxy.target).unwrap()));
    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, state.port))
        .await
        .unwrap();
    let mut bytes = vec![0, 0, 0, 8, 0, 3, 0, 0];
    bytes.extend(std::iter::repeat_n(b'x', CHUNK * 3));
    stream.write_all(&bytes).await.unwrap();
    let mut actual = vec![0; bytes.len()];
    tokio::time::timeout(Duration::from_secs(3), stream.read_exact(&mut actual))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(actual, bytes);
    assert_eq!(state.stats.opened.load(Ordering::Relaxed), 1);
    assert_eq!(proxy.connections.load(Ordering::Relaxed), 1);
    assert_eq!(state.stats.sent.load(Ordering::Relaxed), bytes.len() as u64);
    assert_eq!(
        state.stats.received.load(Ordering::Relaxed),
        bytes.len() as u64
    );
    assert!(!is_idle(&state));
    drop(stream);
    tokio::time::timeout(Duration::from_secs(2), async {
        while state.stats.active.load(Ordering::Acquire) != 0 {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let requests = proxy.connections.load(Ordering::Relaxed);
    tokio::time::sleep(Duration::from_millis(40)).await;
    assert_eq!(proxy.connections.load(Ordering::Relaxed), requests);
    *state.touched.lock().unwrap() = Instant::now() - IDLE - Duration::from_secs(1);
    assert!(is_idle(&state));
    let port = state.port;
    stop(&proxy.target).await;
    assert!(TcpStream::connect((Ipv4Addr::LOCALHOST, port))
        .await
        .is_err());
    assert!(!Arc::ptr_eq(&ensure(&proxy.target).unwrap(), &state));
    stop(&proxy.target).await;
}

#[tokio::test]
async fn invalid_startup_packets_fail_before_opening_any_upstream() {
    let _guard = LIFECYCLE.lock().await;
    let proxy = proxy(None).await;
    let state = ensure(&proxy.target).unwrap();
    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, state.port))
        .await
        .unwrap();
    stream.write_all(b"GET /v2 ").await.unwrap();
    let mut byte = [0];
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(2), stream.read(&mut byte))
            .await
            .unwrap()
            .unwrap(),
        0
    );
    assert_eq!(proxy.connections.load(Ordering::Relaxed), 0);
    assert_eq!(state.stats.opened.load(Ordering::Relaxed), 0);
    stop(&proxy.target).await;
}

#[tokio::test]
async fn websocket_failure_closes_loopback_and_does_not_retry_or_fallback() {
    let _guard = LIFECYCLE.lock().await;
    let unavailable = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await.unwrap();
    let address = unavailable.local_addr().unwrap();
    drop(unavailable);
    let target = test_target(&format!("ws://{address}/v2"));
    let state = ensure(&target).unwrap();
    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, state.port))
        .await
        .unwrap();
    stream.write_all(&[0, 0, 0, 8, 0, 3, 0, 0]).await.unwrap();
    let mut byte = [0];
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(3), stream.read(&mut byte))
            .await
            .unwrap()
            .unwrap(),
        0
    );
    assert_eq!(state.stats.opened.load(Ordering::Relaxed), 0);
    tokio::time::sleep(Duration::from_millis(20)).await;
    assert_eq!(state.stats.accepted.load(Ordering::Relaxed), 1);
    assert_eq!(state.stats.failures.load(Ordering::Relaxed), 1);
    stop(&target).await;
}

#[tokio::test]
async fn secure_websocket_rejects_an_untrusted_certificate() {
    let _guard = LIFECYCLE.lock().await;
    let key = openssl::pkey::PKey::from_rsa(openssl::rsa::Rsa::generate(2048).unwrap()).unwrap();
    let mut name = openssl::x509::X509Name::builder().unwrap();
    name.append_entry_by_text("CN", "localhost").unwrap();
    let name = name.build();
    let mut certificate = openssl::x509::X509::builder().unwrap();
    certificate.set_version(2).unwrap();
    certificate.set_subject_name(&name).unwrap();
    certificate.set_issuer_name(&name).unwrap();
    certificate.set_pubkey(&key).unwrap();
    certificate
        .set_not_before(&openssl::asn1::Asn1Time::days_from_now(0).unwrap())
        .unwrap();
    certificate
        .set_not_after(&openssl::asn1::Asn1Time::days_from_now(1).unwrap())
        .unwrap();
    certificate
        .sign(&key, openssl::hash::MessageDigest::sha256())
        .unwrap();
    let certificate = certificate.build();
    let identity = native_tls::Identity::from_pkcs8(
        &certificate.to_pem().unwrap(),
        &key.private_key_to_pem_pkcs8().unwrap(),
    )
    .unwrap();
    let acceptor = native_tls::TlsAcceptor::new(identity).unwrap();
    let listener = std::net::TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::task::spawn_blocking(move || {
        let (stream, _) = listener.accept().unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        acceptor.accept(stream).is_err()
    });
    let target = Target {
        url: format!("wss://{address}/v2"),
    };
    let state = ensure(&target).unwrap();
    let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, state.port))
        .await
        .unwrap();
    stream.write_all(&[0, 0, 0, 8, 0, 3, 0, 0]).await.unwrap();
    let mut byte = [0];
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), stream.read(&mut byte))
            .await
            .unwrap()
            .unwrap(),
        0
    );
    assert_eq!(state.stats.opened.load(Ordering::Relaxed), 0);
    let _ = server.await.unwrap();
    stop(&target).await;
}

#[tokio::test]
async fn query_capacity_reserves_separate_cancel_slots_and_bounds_buffers() {
    let _guard = LIFECYCLE.lock().await;
    let proxy = proxy(None).await;
    let state = ensure(&proxy.target).unwrap();
    let mut held = Vec::new();
    for _ in 0..MAX_QUERIES {
        held.push(state.queries.clone().try_acquire_owned().unwrap());
    }
    assert!(state.queries.clone().try_acquire_owned().is_err());
    assert!(state.cancels.clone().try_acquire_owned().is_ok());
    assert!(global_cancels().clone().try_acquire_owned().is_ok());
    let config = websocket_config();
    assert_eq!(config.max_frame_size, Some(MAX_MESSAGE));
    assert_eq!(config.max_message_size, Some(MAX_MESSAGE));
    assert_eq!(config.max_write_buffer_size, CHUNK * 3);
    stop(&proxy.target).await;
}

#[tokio::test]
#[ignore = "needs a real local PostgreSQL lab through L8DB_E2E_PG_URL"]
async fn live_postgres_websocket_transactions_pool_reuse_cancellation_and_large_results() {
    let _guard = LIFECYCLE.lock().await;
    let raw = std::env::var("L8DB_E2E_PG_URL").expect("L8DB_E2E_PG_URL required");
    let original = super::super::connection::parse_pg_url(&raw).unwrap();
    let host = match original.config.get_hosts().first().unwrap() {
        tokio_postgres::config::Host::Tcp(host) => host,
        #[cfg(unix)]
        _ => panic!("TCP PostgreSQL test URL required"),
    };
    let address = tokio::net::lookup_host((
        host.as_str(),
        original.config.get_ports().first().copied().unwrap_or(5432),
    ))
    .await
    .unwrap()
    .next()
    .unwrap();
    let proxy = proxy(Some(address)).await;
    let state = ensure(&proxy.target).unwrap();
    let forwarded = rewrite_with_port(url::Url::parse(&raw).unwrap(), state.port).unwrap();
    let (config, tls) = super::super::connection::parse_connection(&forwarded, None).unwrap();
    assert_eq!(managed_port(&config), state.port);
    let pool = super::super::pool::PoolManager::new();
    let pooled = pool
        .get_pool(
            "neon-ws-live",
            config.clone(),
            &tls,
            super::super::pool::PoolUse::Query,
        )
        .await
        .unwrap();
    let client = pooled.get_owned().await.unwrap();
    client.batch_execute("BEGIN; CREATE TEMP TABLE l8db_neon_wire_test(id integer); INSERT INTO l8db_neon_wire_test VALUES (1); ROLLBACK").await.unwrap();
    assert!(client
        .query_one(
            "SELECT to_regclass('pg_temp.l8db_neon_wire_test') IS NULL",
            &[]
        )
        .await
        .unwrap()
        .get::<_, bool>(0));
    let before = state.stats.opened.load(Ordering::Relaxed);
    let mut samples = Vec::new();
    let mut result_bytes = 0;
    for _ in 0..9 {
        let started = Instant::now();
        let stream = client
            .query_raw(
                "SELECT n::bigint, repeat('x',64) FROM generate_series(1,100000) n",
                std::iter::empty::<&(dyn tokio_postgres::types::ToSql + Sync)>(),
            )
            .await
            .unwrap();
        tokio::pin!(stream);
        let mut rows = 0;
        while let Some(row) = stream.next().await {
            let row = row.unwrap();
            result_bytes += row.get::<_, String>(1).len();
            rows += 1;
        }
        assert_eq!(rows, 100_000);
        samples.push(started.elapsed());
    }
    samples.sort();
    assert_eq!(state.stats.opened.load(Ordering::Relaxed), before);
    assert_eq!(result_bytes, 9 * 100_000 * 64);
    assert!(samples[4] < Duration::from_secs(2));
    assert!(samples[8] < Duration::from_secs(4));
    let token = client.cancel_token();
    let slow = client.query("SELECT pg_sleep(20)", &[]);
    let cancel = async {
        tokio::time::sleep(Duration::from_millis(100)).await;
        let started = Instant::now();
        token.cancel_query(tokio_postgres::NoTls).await.unwrap();
        started
    };
    let (result, cancelled) = tokio::join!(slow, cancel);
    assert_eq!(
        result.unwrap_err().as_db_error().unwrap().code().code(),
        "57014"
    );
    assert!(cancelled.elapsed() < Duration::from_secs(2));
    assert_eq!(state.stats.opened.load(Ordering::Relaxed), before + 1);
    let opens = state.stats.opened.load(Ordering::Relaxed);
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(state.stats.opened.load(Ordering::Relaxed), opens);
    eprintln!("Neon WebSocket local PG proxy: 9 x 100000 rows/64-byte text streamed, {} bytes, median {:?}, p95 {:?}, physical PG session reused, cancellation WSS request 1, peak connections {}, frame <=4MiB/write buffer <=192KiB, idle requests 0", result_bytes, samples[4], samples[8], state.stats.peak.load(Ordering::Relaxed));
    drop(client);
    stop(&proxy.target).await;
    let fresh = ensure(&proxy.target).unwrap();
    assert!(!Arc::ptr_eq(&fresh, &state));
    let forwarded = rewrite_with_port(url::Url::parse(&raw).unwrap(), fresh.port).unwrap();
    let (config, tls) = super::super::connection::parse_connection(&forwarded, None).unwrap();
    let fresh_pool = pool
        .get_pool(
            "neon-ws-live",
            config,
            &tls,
            super::super::pool::PoolUse::Query,
        )
        .await
        .unwrap();
    let client = fresh_pool.get_owned().await.unwrap();
    assert_eq!(
        client
            .query_one("SELECT 42::integer", &[])
            .await
            .unwrap()
            .get::<_, i32>(0),
        42
    );
    assert_eq!(fresh.stats.opened.load(Ordering::Relaxed), 1);
    drop(client);
    drop(fresh_pool);
    drop(pooled);
    pool.remove_pool("neon-ws-live").await;
    stop(&proxy.target).await;
}

#[tokio::test]
#[ignore = "needs local PostgreSQL L8DB_E2E_PG_URL and pg_dump (or L8DB_BACKUP_PG_DUMP)"]
async fn live_postgres_websocket_pg_dump_uses_loopback_transport() {
    let _guard = LIFECYCLE.lock().await;
    let raw = std::env::var("L8DB_E2E_PG_URL").expect("L8DB_E2E_PG_URL required");
    let original = super::super::connection::parse_pg_url(&raw).unwrap();
    let host = match original.config.get_hosts().first().unwrap() {
        tokio_postgres::config::Host::Tcp(host) => host,
        #[cfg(unix)]
        _ => panic!("TCP PostgreSQL test URL required"),
    };
    let address = tokio::net::lookup_host((
        host.as_str(),
        original.config.get_ports().first().copied().unwrap_or(5432),
    ))
    .await
    .unwrap()
    .next()
    .unwrap();
    let proxy = proxy(Some(address)).await;
    let state = ensure(&proxy.target).unwrap();
    let forwarded = rewrite_with_port(url::Url::parse(&raw).unwrap(), state.port).unwrap();
    let (environment, _) = super::super::backup::pg_env(&forwarded, None).unwrap();
    assert!(environment
        .iter()
        .any(|(key, value)| key == "PGHOST" && value == "127.0.0.1"));
    assert!(environment
        .iter()
        .any(|(key, value)| key == "PGPORT" && value == &state.port.to_string()));
    assert!(environment
        .iter()
        .any(|(key, value)| key == "PGSSLMODE" && value == "disable"));
    let binary = std::env::var_os("L8DB_BACKUP_PG_DUMP").unwrap_or_else(|| "pg_dump".into());
    let output = tokio::time::timeout(
        Duration::from_secs(30),
        crate::process::command(binary)
            .envs(environment)
            .args(["--schema-only", "--no-owner", "--no-privileges"])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        output.status.success(),
        "pg_dump did not finish successfully"
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("PostgreSQL database dump"));
    assert!(state.stats.opened.load(Ordering::Relaxed) >= 1);
    assert!(state.stats.sent.load(Ordering::Relaxed) > 0);
    stop(&proxy.target).await;
}
