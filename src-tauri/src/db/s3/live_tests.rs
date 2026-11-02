use std::sync::{Arc, Mutex};

use super::client::S3;
use super::ops::{ObjectProperties, ObjectRef, TransferItem};
use super::transfer::{self, TransferEvent};
use crate::db::DatabaseAdapter;

fn url() -> String {
    std::env::var("L8DB_E2E_S3_URL").unwrap_or_else(|_| {
        "s3://l8dbadmin:l8dbsecret@us-east-1?endpoint=http%3A%2F%2F127.0.0.1%3A9000".to_string()
    })
}

fn bucket_name(tag: &str) -> String {
    format!("l8db-live-{tag}-{}", chrono::Utc::now().format("%H%M%S%3f"))
}

fn events() -> (Arc<Mutex<Vec<TransferEvent>>>, transfer::Emit) {
    let store = Arc::new(Mutex::new(Vec::new()));
    let sink = store.clone();
    (store, Arc::new(move |e| sink.lock().unwrap().push(e)))
}

#[tokio::test]
#[ignore]
async fn s3_live_object_lifecycle() {
    let s3 = S3::connect(&url()).await.unwrap();
    let bucket = bucket_name("obj");
    s3.create_bucket(&bucket, None, false).await.unwrap();
    assert!(s3
        .list_buckets()
        .await
        .unwrap()
        .iter()
        .any(|b| b.name == bucket));

    let dir = tempfile::tempdir().unwrap();
    let folder = dir.path().join("upload");
    std::fs::create_dir_all(folder.join("nested")).unwrap();
    std::fs::write(folder.join("a b.txt"), "hello wörld").unwrap();
    std::fs::write(folder.join("nested/data.csv"), "id,name\n1,x\n2,y\n").unwrap();
    let big: Vec<u8> = (0..(transfer::PART_SIZE as usize * 2 + 12345))
        .map(|i| (i % 251) as u8)
        .collect();
    std::fs::write(dir.path().join("big.bin"), &big).unwrap();

    let (log, emit) = events();
    let summary = transfer::upload(
        &s3,
        &bucket,
        "in",
        &[
            folder.to_string_lossy().into_owned(),
            dir.path().join("big.bin").to_string_lossy().into_owned(),
        ],
        &ObjectProperties::default(),
        false,
        "up-1",
        emit,
    )
    .await
    .unwrap();
    assert!(summary.errors.is_empty(), "{:?}", summary.errors);
    assert_eq!(summary.files, 3);
    assert_eq!(log.lock().unwrap().last().unwrap().state, "done");

    let root = s3
        .list_objects(&bucket, "in/", Some("/"), None, None)
        .await
        .unwrap();
    assert_eq!(root.prefixes, vec!["in/upload/"]);
    assert_eq!(root.objects.len(), 1);
    assert_eq!(root.objects[0].size, big.len() as u64);

    let head = s3
        .head_object(&bucket, "in/upload/a b.txt", None)
        .await
        .unwrap();
    assert_eq!(head.content_type.as_deref(), Some("text/plain"));
    assert_eq!(head.size, "hello wörld".len() as u64);

    let preview = s3.preview(&bucket, "in/big.bin", None, 100).await.unwrap();
    assert!(preview.truncated);
    assert_eq!(preview.size, big.len() as u64);

    assert_eq!(
        s3.get_text(&bucket, "in/upload/a b.txt").await.unwrap(),
        "hello wörld"
    );
    s3.put_bytes(
        &bucket,
        "notes/x.json",
        b"{\"a\":1}".to_vec(),
        &[("content-type".into(), "application/json".into())],
    )
    .await
    .unwrap();

    let mut props = ObjectProperties {
        content_type: Some("application/vnd.test".into()),
        cache_control: Some("max-age=60".into()),
        ..Default::default()
    };
    props.metadata.insert("owner".into(), "l8db".into());
    s3.update_properties(&bucket, "notes/x.json", &props)
        .await
        .unwrap();
    let head = s3.head_object(&bucket, "notes/x.json", None).await.unwrap();
    assert_eq!(head.content_type.as_deref(), Some("application/vnd.test"));
    assert_eq!(head.metadata.get("owner").map(String::as_str), Some("l8db"));
    assert_eq!(head.cache_control.as_deref(), Some("max-age=60"));

    s3.put_config(
        &bucket,
        Some("notes/x.json"),
        None,
        "tagging",
        "<Tagging><TagSet><Tag><Key>env</Key><Value>lab</Value></Tag></TagSet></Tagging>".into(),
        false,
    )
    .await
    .unwrap();
    let tags = s3
        .get_config(&bucket, Some("notes/x.json"), None, "tagging")
        .await
        .unwrap()
        .unwrap();
    assert!(tags.contains("<Value>lab</Value>"));

    s3.create_folder(&bucket, "empty/sub").await.unwrap();
    let listing = s3
        .list_objects(&bucket, "empty/", Some("/"), None, None)
        .await
        .unwrap();
    assert_eq!(listing.prefixes, vec!["empty/sub/"]);

    let outcome = s3
        .copy_items(
            &bucket,
            &[TransferItem {
                key: "in/upload/".into(),
                version_id: None,
                is_prefix: true,
            }],
            &bucket,
            "copy/",
            false,
            false,
        )
        .await
        .unwrap();
    assert_eq!(outcome.deleted, 2, "{:?}", outcome.errors);
    let upload_dir = [TransferItem {
        key: "in/upload/".into(),
        version_id: None,
        is_prefix: true,
    }];
    let conflict = s3
        .copy_items(&bucket, &upload_dir, &bucket, "copy/", false, false)
        .await
        .unwrap_err();
    assert!(
        conflict.starts_with(super::ops::CONFLICT_PREFIX),
        "{conflict}"
    );
    assert_eq!(
        s3.copy_items(&bucket, &upload_dir, &bucket, "copy/", false, true)
            .await
            .unwrap()
            .deleted,
        2
    );
    assert!(s3
        .copy_items(&bucket, &upload_dir, &bucket, "in/upload/sub/", true, false)
        .await
        .unwrap_err()
        .contains("in sich selbst"));
    assert!(s3
        .head_object(&bucket, "copy/upload/nested/data.csv", None)
        .await
        .is_ok());

    let renamed = s3
        .rename(&bucket, "copy/upload/", "moved/up", false)
        .await
        .unwrap();
    assert!(renamed.errors.is_empty());
    assert!(s3
        .head_object(&bucket, "moved/up/a b.txt", None)
        .await
        .is_ok());
    assert!(s3
        .head_object(&bucket, "copy/upload/a b.txt", None)
        .await
        .is_err());
    s3.rename(&bucket, "moved/up/a b.txt", "moved/renamed.txt", false)
        .await
        .unwrap();
    assert!(s3
        .head_object(&bucket, "moved/renamed.txt", None)
        .await
        .is_ok());

    let (records, _) = super::select::select(
        &s3,
        &bucket,
        "in/upload/nested/data.csv",
        "SELECT s.name FROM S3Object s WHERE s.id = '2'",
    )
    .await
    .unwrap();
    let result = super::select::records_to_result(&records, 0, false);
    assert_eq!(result.rows, vec![serde_json::json!({"name": "y"})]);

    let adapter = super::S3Adapter::new(&url()).unwrap();
    adapter.test_connection().await.unwrap();
    let query = adapter
        .execute_query(&format!(
            "SELECT * FROM s3://{bucket}/in/upload/nested/data.csv"
        ))
        .await
        .unwrap();
    assert_eq!(query.columns, vec!["id", "name"]);
    assert_eq!(query.rows.len(), 2);
    let list = adapter
        .execute_query(&format!("LIST s3://{bucket}/in/"))
        .await
        .unwrap();
    assert_eq!(list.rows.len(), 2);
    let tables = adapter.list_tables(None).await.unwrap();
    assert!(tables.iter().any(|t| t.name == bucket));
    let rows = adapter
        .fetch_rows("", &bucket, Some("in/"), 2, 1, None, false, false, false)
        .await
        .unwrap();
    assert_eq!(rows.rows.len(), 2);

    let url = s3.presign("GET", &bucket, "in/upload/a b.txt", 60, &[]);
    let body = reqwest::get(&url).await.unwrap();
    assert!(body.status().is_success(), "{}", body.status());
    assert_eq!(body.text().await.unwrap(), "hello wörld");
    let put_url = s3.presign("PUT", &bucket, "presigned.txt", 60, &[]);
    let put = reqwest::Client::new()
        .put(&put_url)
        .body("via presign")
        .send()
        .await
        .unwrap();
    assert!(put.status().is_success());
    assert_eq!(
        s3.get_text(&bucket, "presigned.txt").await.unwrap(),
        "via presign"
    );

    let stats = s3.bucket_stats(&bucket, "").await.unwrap();
    assert!(stats.objects >= 8);
    let (hits, _) = s3.search(&bucket, "", "DATA", 10).await.unwrap();
    assert!(hits.iter().any(|h| h.key == "in/upload/nested/data.csv"));

    let (log, emit) = events();
    let out = dir.path().join("out");
    std::fs::create_dir_all(&out).unwrap();
    let summary = transfer::download(
        &s3,
        &bucket,
        &[
            TransferItem {
                key: "in/upload/".into(),
                version_id: None,
                is_prefix: true,
            },
            TransferItem {
                key: "in/big.bin".into(),
                version_id: None,
                is_prefix: false,
            },
        ],
        &out.to_string_lossy(),
        "down-1",
        emit,
    )
    .await
    .unwrap();
    assert!(summary.errors.is_empty(), "{:?}", summary.errors);
    assert_eq!(std::fs::read(out.join("big.bin")).unwrap(), big);
    assert_eq!(
        std::fs::read_to_string(out.join("upload/nested/data.csv")).unwrap(),
        "id,name\n1,x\n2,y\n"
    );
    let last = log.lock().unwrap().last().cloned().unwrap();
    assert_eq!(last.bytes_done, last.bytes_total);
    let single = dir.path().join("single.txt");
    transfer::download(
        &s3,
        &bucket,
        &[TransferItem {
            key: "presigned.txt".into(),
            version_id: None,
            is_prefix: false,
        }],
        &single.to_string_lossy(),
        "down-2",
        events().1,
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read_to_string(single).unwrap(), "via presign");

    let deleted = s3
        .delete_prefix(&bucket, "in/", false, false)
        .await
        .unwrap();
    assert_eq!(deleted.deleted, 3);
    let removed = s3
        .delete_objects(
            &bucket,
            &[ObjectRef {
                key: "presigned.txt".into(),
                version_id: None,
            }],
            false,
        )
        .await
        .unwrap();
    assert_eq!(removed.deleted, 1);

    s3.delete_bucket(&bucket, true).await.unwrap();
    assert!(!s3
        .list_buckets()
        .await
        .unwrap()
        .iter()
        .any(|b| b.name == bucket));
}

#[tokio::test]
#[ignore]
async fn s3_live_bucket_configuration() {
    let s3 = S3::connect(&url()).await.unwrap();
    let bucket = bucket_name("cfg");
    s3.create_bucket(&bucket, None, false).await.unwrap();

    assert!(s3
        .get_config(&bucket, None, None, "policy")
        .await
        .unwrap()
        .is_none());
    let policy = format!(
        r#"{{"Version":"2012-10-17","Statement":[{{"Effect":"Allow","Principal":{{"AWS":["*"]}},"Action":["s3:GetObject"],"Resource":["arn:aws:s3:::{bucket}/public/*"]}}]}}"#
    );
    s3.put_config(&bucket, None, None, "policy", policy, false)
        .await
        .unwrap();
    assert!(s3
        .get_config(&bucket, None, None, "policy")
        .await
        .unwrap()
        .unwrap()
        .contains("s3:GetObject"));
    s3.put_bytes(&bucket, "public/hi.txt", b"hi".to_vec(), &[])
        .await
        .unwrap();
    let anonymous = reqwest::get(format!("http://127.0.0.1:9000/{bucket}/public/hi.txt"))
        .await
        .unwrap();
    assert!(anonymous.status().is_success());
    s3.delete_config(&bucket, None, None, "policy")
        .await
        .unwrap();
    assert!(s3
        .get_config(&bucket, None, None, "policy")
        .await
        .unwrap()
        .is_none());

    s3.put_config(&bucket, None, None, "versioning",
        r#"<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Status>Enabled</Status></VersioningConfiguration>"#.into(), false)
        .await
        .unwrap();
    assert!(s3
        .get_config(&bucket, None, None, "versioning")
        .await
        .unwrap()
        .unwrap()
        .contains("Enabled"));
    for v in ["one", "two", "three"] {
        s3.put_bytes(&bucket, "doc.txt", v.as_bytes().to_vec(), &[])
            .await
            .unwrap();
    }
    let versions = s3
        .list_versions(&bucket, "doc", None, None, None, None)
        .await
        .unwrap();
    assert_eq!(versions.versions.len(), 3);
    let oldest = versions.versions.last().unwrap().version_id.clone();
    s3.copy_object(&bucket, "doc.txt", Some(&oldest), &bucket, "doc.txt", None)
        .await
        .unwrap();
    assert_eq!(s3.get_text(&bucket, "doc.txt").await.unwrap(), "one");
    s3.delete_objects(
        &bucket,
        &[ObjectRef {
            key: "doc.txt".into(),
            version_id: None,
        }],
        false,
    )
    .await
    .unwrap();
    let versions = s3
        .list_versions(&bucket, "", None, None, None, None)
        .await
        .unwrap();
    assert!(versions
        .versions
        .iter()
        .any(|v| v.delete_marker && v.is_latest));

    s3.put_config(
        &bucket,
        None,
        None,
        "tagging",
        "<Tagging><TagSet><Tag><Key>team</Key><Value>data</Value></Tag></TagSet></Tagging>".into(),
        false,
    )
    .await
    .unwrap();
    assert!(s3
        .get_config(&bucket, None, None, "tagging")
        .await
        .unwrap()
        .unwrap()
        .contains("data"));

    s3.put_config(&bucket, None, None, "lifecycle",
        "<LifecycleConfiguration><Rule><ID>expire-tmp</ID><Status>Enabled</Status><Filter><Prefix>tmp/</Prefix></Filter><Expiration><Days>7</Days></Expiration></Rule></LifecycleConfiguration>".into(), false)
        .await
        .unwrap();
    assert!(s3
        .get_config(&bucket, None, None, "lifecycle")
        .await
        .unwrap()
        .unwrap()
        .contains("expire-tmp"));
    s3.delete_config(&bucket, None, None, "lifecycle")
        .await
        .unwrap();

    let upload = s3
        .xml(
            super::client::Request::new(reqwest::Method::POST, Some(&bucket), Some("pending.bin"))
                .query("uploads", ""),
        )
        .await
        .unwrap();
    let upload_id = upload.text_of("UploadId").unwrap();
    let pending = s3.list_multipart_uploads(&bucket).await.unwrap();
    assert!(pending.iter().any(|u| u.upload_id == upload_id));
    s3.abort_multipart(&bucket, "pending.bin", &upload_id)
        .await
        .unwrap();
    assert!(s3.list_multipart_uploads(&bucket).await.unwrap().is_empty());

    assert!(s3
        .get_config(&bucket, None, None, "nonsense")
        .await
        .is_err());
    s3.delete_bucket(&bucket, true).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn s3_live_object_lock() {
    let s3 = S3::connect(&url()).await.unwrap();
    let bucket = bucket_name("lock");
    s3.create_bucket(&bucket, None, true).await.unwrap();
    let lock = s3
        .get_config(&bucket, None, None, "object-lock")
        .await
        .unwrap()
        .unwrap();
    assert!(lock.contains("Enabled"));
    s3.put_config(&bucket, None, None, "object-lock",
        "<ObjectLockConfiguration><ObjectLockEnabled>Enabled</ObjectLockEnabled><Rule><DefaultRetention><Mode>GOVERNANCE</Mode><Days>1</Days></DefaultRetention></Rule></ObjectLockConfiguration>".into(), false)
        .await
        .unwrap();
    let version = s3
        .put_bytes(&bucket, "c.txt", b"x".to_vec(), &[])
        .await
        .unwrap()
        .unwrap();
    let head = s3.head_object(&bucket, "c.txt", None).await.unwrap();
    assert_eq!(head.retention_mode.as_deref(), Some("GOVERNANCE"));

    s3.put_config(
        &bucket,
        Some("c.txt"),
        Some(&version),
        "legal-hold",
        "<LegalHold><Status>ON</Status></LegalHold>".into(),
        false,
    )
    .await
    .unwrap();
    assert!(s3
        .get_config(&bucket, Some("c.txt"), Some(&version), "legal-hold")
        .await
        .unwrap()
        .unwrap()
        .contains("ON"));
    let blocked = s3
        .delete_objects(
            &bucket,
            &[ObjectRef {
                key: "c.txt".into(),
                version_id: Some(version.clone()),
            }],
            true,
        )
        .await
        .unwrap();
    assert_eq!(blocked.errors.len(), 1);
    s3.put_config(
        &bucket,
        Some("c.txt"),
        Some(&version),
        "legal-hold",
        "<LegalHold><Status>OFF</Status></LegalHold>".into(),
        false,
    )
    .await
    .unwrap();
    let until = (chrono::Utc::now() + chrono::Duration::days(2)).format("%Y-%m-%dT%H:%M:%SZ");
    s3.put_config(&bucket, Some("c.txt"), Some(&version), "retention",
        format!("<Retention><Mode>GOVERNANCE</Mode><RetainUntilDate>{until}</RetainUntilDate></Retention>"), false)
        .await
        .unwrap();
    assert!(s3
        .get_config(&bucket, Some("c.txt"), Some(&version), "retention")
        .await
        .unwrap()
        .unwrap()
        .contains("GOVERNANCE"));
    let without_bypass = s3
        .delete_objects(
            &bucket,
            &[ObjectRef {
                key: "c.txt".into(),
                version_id: Some(version.clone()),
            }],
            false,
        )
        .await
        .unwrap();
    assert_eq!(without_bypass.errors.len(), 1);
    s3.delete_bucket(&bucket, true).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn s3_live_replace_text_keeps_properties() {
    let s3 = S3::connect(&url()).await.unwrap();
    let bucket = bucket_name("txt");
    s3.create_bucket(&bucket, None, false).await.unwrap();
    s3.put_bytes(
        &bucket,
        "cfg/app.json",
        b"{}".to_vec(),
        &[
            ("content-type".to_string(), "application/json".to_string()),
            ("cache-control".to_string(), "max-age=60".to_string()),
            ("x-amz-meta-owner".to_string(), "ops".to_string()),
            (
                "x-amz-tagging".to_string(),
                "env=prod&team=a%20b".to_string(),
            ),
        ],
    )
    .await
    .unwrap();
    s3.replace_text(
        &bucket,
        "cfg/app.json",
        "{\"a\":1}".into(),
        None,
        "text/plain",
        None,
    )
    .await
    .unwrap();
    let head = s3.head_object(&bucket, "cfg/app.json", None).await.unwrap();
    assert_eq!(head.size, 7);
    assert_eq!(head.content_type.as_deref(), Some("application/json"));
    assert_eq!(head.cache_control.as_deref(), Some("max-age=60"));
    assert_eq!(head.metadata.get("owner").map(String::as_str), Some("ops"));
    assert_eq!(head.tag_count, 2);
    let tags = s3
        .get_config(&bucket, Some("cfg/app.json"), None, "tagging")
        .await
        .unwrap()
        .unwrap();
    assert!(tags.contains("<Value>a b</Value>"));

    s3.replace_text(
        &bucket,
        "new.md",
        "# hi".into(),
        None,
        "text/markdown",
        None,
    )
    .await
    .unwrap();
    let fresh = s3.head_object(&bucket, "new.md", None).await.unwrap();
    assert_eq!(fresh.content_type.as_deref(), Some("text/markdown"));

    s3.delete_bucket(&bucket, true).await.unwrap();
}

#[tokio::test]
#[ignore]
async fn s3_live_safety_checks() {
    let s3 = S3::connect(&url()).await.unwrap();
    let bucket = bucket_name("safe");
    s3.create_bucket(&bucket, None, false).await.unwrap();

    let dotted = s3
        .put_bytes(&bucket, "a/../x", b"x".to_vec(), &[])
        .await
        .unwrap_err();
    assert!(dotted.contains("Pfadsegmente"), "{dotted}");
    let invalid = s3
        .put_bytes(
            &bucket,
            "meta.txt",
            b"x".to_vec(),
            &[("x-amz-meta-mein feld".into(), "v".into())],
        )
        .await
        .unwrap_err();
    assert!(invalid.contains("Metadaten-Schlüssel"), "{invalid}");

    s3.put_bytes(
        &bucket,
        "cr\rkey.txt",
        b"x".to_vec(),
        &[("x-amz-meta-autor".into(), "Müller".into())],
    )
    .await
    .unwrap();
    let listing = s3
        .list_objects(&bucket, "", None, None, None)
        .await
        .unwrap();
    assert_eq!(listing.objects[0].key, "cr\rkey.txt");
    let head = s3.head_object(&bucket, "cr\rkey.txt", None).await.unwrap();
    s3.replace_text(
        &bucket,
        "cr\rkey.txt",
        "neu".into(),
        None,
        "text/plain",
        head.etag.as_deref(),
    )
    .await
    .unwrap();
    let stale = s3
        .replace_text(
            &bucket,
            "cr\rkey.txt",
            "alt".into(),
            None,
            "text/plain",
            head.etag.as_deref(),
        )
        .await
        .unwrap_err();
    assert!(stale.contains("geändert"), "{stale}");
    let after = s3.head_object(&bucket, "cr\rkey.txt", None).await.unwrap();
    assert_ne!(after.metadata.get("autor").map(String::as_str), Some(""));

    s3.put_bytes(&bucket, "b.txt", b"b".to_vec(), &[])
        .await
        .unwrap();
    s3.put_bytes(&bucket, "c.txt", b"c".to_vec(), &[])
        .await
        .unwrap();
    let conflict = s3
        .rename(&bucket, "b.txt", "c.txt", false)
        .await
        .unwrap_err();
    assert!(
        conflict.starts_with(super::ops::CONFLICT_PREFIX),
        "{conflict}"
    );
    s3.rename(&bucket, "b.txt", "c.txt", true).await.unwrap();

    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("c.txt"), "lokal").unwrap();
    let upload_conflict = transfer::upload(
        &s3,
        &bucket,
        "",
        &[dir.path().join("c.txt").to_string_lossy().into_owned()],
        &ObjectProperties::default(),
        false,
        "safe-up",
        events().1,
    )
    .await
    .unwrap_err();
    assert!(upload_conflict.starts_with(super::ops::CONFLICT_PREFIX));
    let item = |key: &str| TransferItem {
        key: key.into(),
        version_id: None,
        is_prefix: false,
    };
    let summary = transfer::download(
        &s3,
        &bucket,
        &[item("c.txt"), item("cr\rkey.txt")],
        &dir.path().to_string_lossy(),
        "safe-down",
        events().1,
    )
    .await
    .unwrap();
    assert!(summary.errors.is_empty(), "{:?}", summary.errors);
    assert_eq!(
        std::fs::read_to_string(dir.path().join("c.txt")).unwrap(),
        "lokal"
    );
    assert_eq!(
        std::fs::read_to_string(dir.path().join("c (2).txt")).unwrap(),
        "b"
    );

    let pinned = url().replacen('?', &format!("/{bucket}?"), 1);
    let adapter = super::S3Adapter::new(&pinned).unwrap();
    adapter.test_connection().await.unwrap();

    s3.delete_bucket(&bucket, true).await.unwrap();
}
