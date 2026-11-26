use std::convert::Infallible;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::{
    body::{Body, Bytes},
    http::Response,
    Router,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::stream;
use tokio::time::timeout;

use super::ops::MAX_TEXT_BYTES;
use super::{client::S3, tests::url};
use crate::db::http_mock;

#[tokio::test]
async fn null_version_head_preserves_the_reported_or_requested_id() {
    let server = http_mock::start_with_headers(|req| {
        let headers = match req.route().rsplit('/').next().unwrap() {
            "legacy" => vec![("x-amz-version-id".into(), "null".into())],
            "current" => vec![("x-amz-version-id".into(), "v2".into())],
            _ => vec![],
        };
        (200, headers, vec![])
    });
    let s3 = S3::connect(&url(&server)).await.unwrap();
    for (key, requested, expected) in [
        ("legacy", None, Some("null")),
        ("current", None, Some("v2")),
        ("no-header", Some("null"), Some("null")),
        ("no-header", Some("v1"), Some("v1")),
        ("no-header", None, None),
        ("no-header", Some(""), None),
    ] {
        let head = s3.head_object("sample", key, requested).await.unwrap();
        assert_eq!(head.version_id.as_deref(), expected);
    }
    let requests = server.requests();
    assert_eq!(requests.len(), 6);
    assert!(requests.iter().all(|r| r.method == "HEAD"));
    assert_eq!(requests[2].query("versionId").as_deref(), Some("null"));
    assert!(requests[4].query("versionId").is_none());
}

#[tokio::test]
async fn preview_budget_when_the_server_returns_the_full_object() {
    const SIZE: usize = 8 * 1024 * 1024;
    let server = http_mock::start(|_| (200, vec![b'x'; SIZE]));
    let s3 = S3::connect(&url(&server)).await.unwrap();
    let mut samples = Vec::new();
    let mut encoded = 0;
    for run in 0..16 {
        let start = Instant::now();
        let result = s3
            .preview("sample", "large.pdf", Some("v2"), 2048)
            .await
            .unwrap();
        if run > 0 {
            samples.push(start.elapsed());
        }
        encoded = encoded.max(result.data.len());
        assert_eq!(result.size, Some(SIZE as u64));
    }
    samples.sort();
    let median = samples[7];
    let p95 = samples[14];
    let requests = server.requests();
    eprintln!("native S3 preview: object={SIZE} encoded={encoded} requests={} median={median:?} p95={p95:?}", requests.len());
    assert_eq!(encoded, 2732);
    assert_eq!(requests.len(), 16);
    assert!(requests.iter().all(|r| r.method == "GET"
        && r.header("range") == Some("bytes=0-2047")
        && r.query("versionId").as_deref() == Some("v2")));
    assert!(median < Duration::from_millis(40));
    assert!(p95 < Duration::from_millis(150));
}

#[tokio::test]
async fn range_metadata_separates_the_prefix_from_the_full_object() {
    let server = http_mock::start_with_headers(|r| {
        let key = r.route().rsplit('/').next().unwrap();
        let range = match key {
            "full" => return (200, vec![], b"hello".to_vec()),
            "empty" => return (200, vec![], vec![]),
            "empty-range" => {
                return (
                    416,
                    vec![],
                    b"<Error><Code>InvalidRange</Code></Error>".to_vec(),
                )
            }
            "denied" => {
                return (
                    403,
                    vec![],
                    b"<Error><Code>AccessDenied</Code></Error>".to_vec(),
                )
            }
            "complete" => "bytes 0-4/5",
            "partial" => "bytes 0-4/12",
            "unknown" => "bytes 0-4/*",
            "offset" => "bytes 1-5/12",
            "short" => "bytes 0-6/12",
            "invalid-size" => "bytes 0-4/3",
            "missing" => return (206, vec![], b"hello".to_vec()),
            "binary" => return (200, vec![], vec![0xff]),
            _ => unreachable!(),
        };
        (
            206,
            vec![("Content-Range".into(), range.into())],
            b"hello".to_vec(),
        )
    });
    let s3 = S3::connect(&url(&server)).await.unwrap();
    for (key, total, truncated) in [
        ("full", Some(5), false),
        ("complete", Some(5), false),
        ("partial", Some(12), true),
        ("unknown", None, true),
        ("empty", Some(0), false),
        ("empty-range", Some(0), false),
    ] {
        let result = s3.preview("sample", key, None, 8).await.unwrap();
        assert_eq!((result.size, result.truncated), (total, truncated), "{key}");
        let expected = if total == Some(0) { "" } else { "hello" };
        assert_eq!(STANDARD.decode(result.data).unwrap(), expected.as_bytes());
    }
    for key in ["offset", "short", "missing", "invalid-size", "denied"] {
        assert!(s3.preview("sample", key, None, 8).await.is_err(), "{key}");
    }
    let preview_reads = server.requests().len();
    for key in ["full", "complete", "empty"] {
        let text = s3.get_text("sample", key).await.unwrap();
        assert_eq!(text, if key == "empty" { "" } else { "hello" });
    }
    for key in ["partial", "unknown", "empty-range", "denied", "binary"] {
        assert!(s3.get_text("sample", key).await.is_err(), "{key}");
    }
    let requests = server.requests();
    assert_eq!(requests.len(), preview_reads + 8);
    assert!(requests[preview_reads..]
        .iter()
        .all(|r| r.header("range").is_none()));
}

async fn serve(router: Router) -> (S3, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let task = tokio::spawn(async move { axum::serve(listener, router).await.unwrap() });
    let endpoint = format!("s3://ak:sk@us-east-1?endpoint=http://{address}");
    (S3::connect(&endpoint).await.unwrap(), task)
}

#[tokio::test]
async fn chunked_objects_keep_unknown_sizes_and_editor_limits() {
    let router = Router::new().fallback(|uri: axum::http::Uri| async move {
        let bytes = match uri.path().rsplit('/').next().unwrap() {
            "empty" => Bytes::new(),
            "small" => Bytes::from_static(b"abcd"),
            "limit" => Bytes::from(vec![b'a'; MAX_TEXT_BYTES as usize]),
            "overflow" => Bytes::from(vec![b'a'; MAX_TEXT_BYTES as usize + 1]),
            _ => unreachable!(),
        };
        let chunks = stream::iter([Ok::<_, Infallible>(bytes)]);
        Body::from_stream(chunks)
    });
    let (s3, server) = serve(router).await;
    for (limit, size, complete, prefix) in [
        (3, None, false, "abc"),
        (4, Some(4), true, "abcd"),
        (8, Some(4), true, "abcd"),
    ] {
        let result = s3.preview("sample", "small", None, limit).await.unwrap();
        assert_eq!((result.size, result.truncated), (size, !complete));
        assert_eq!(STANDARD.decode(result.data).unwrap(), prefix.as_bytes());
    }
    assert_eq!(s3.get_text("sample", "empty").await.unwrap(), "");
    assert_eq!(
        s3.get_text("sample", "limit").await.unwrap().len(),
        MAX_TEXT_BYTES as usize
    );
    assert!(s3
        .get_text("sample", "overflow")
        .await
        .unwrap_err()
        .contains("zu groß"));
    server.abort();
}

#[tokio::test]
async fn bounded_reads_release_a_stalled_body() {
    for editor in [false, true] {
        let (sender, receiver) = tokio::sync::mpsc::channel::<Bytes>(1);
        if !editor {
            sender.try_send(Bytes::from_static(&[b'x'; 2048])).unwrap();
        }
        let receiver = Arc::new(Mutex::new(Some(receiver)));
        let router = Router::new().fallback(move || {
            let rx = receiver.lock().unwrap().take().unwrap();
            async move {
                let chunks = stream::unfold(rx, |mut rx| async move {
                    rx.recv().await.map(|b| (Ok::<_, Infallible>(b), rx))
                });
                Response::builder()
                    .header("content-length", MAX_TEXT_BYTES + 1)
                    .body(Body::from_stream(chunks))
                    .unwrap()
            }
        });
        let (s3, server) = serve(router).await;
        let deadline = Duration::from_secs(3);
        if editor {
            let error = timeout(deadline, s3.get_text("sample", "large"))
                .await
                .unwrap()
                .unwrap_err();
            assert!(error.contains("zu groß"));
        } else {
            let preview = timeout(deadline, s3.preview("sample", "large", None, 2048))
                .await
                .unwrap()
                .unwrap();
            assert!(preview.truncated);
            assert_eq!(preview.data.len(), 2732);
        }
        timeout(deadline, sender.closed())
            .await
            .expect("server body should be dropped");
        server.abort();
    }
}
