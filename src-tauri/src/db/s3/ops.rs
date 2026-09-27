use std::collections::BTreeMap;

use reqwest::Method;
use serde::{Deserialize, Serialize};

use super::client::{uri_encode, Request, S3Error, S3};
use super::xml::{self, Node};

pub const MAX_PREVIEW_BYTES: u64 = 16 * 1024 * 1024;
pub const MAX_TEXT_BYTES: u64 = 8 * 1024 * 1024;
pub const S3_XMLNS: &str = "http://s3.amazonaws.com/doc/2006-03-01/";

#[derive(Debug, Clone, Serialize)]
pub struct BucketInfo {
    pub name: String,
    pub creation_date: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObjectEntry {
    pub key: String,
    pub size: u64,
    pub last_modified: Option<String>,
    pub etag: Option<String>,
    pub storage_class: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObjectListing {
    pub prefixes: Vec<String>,
    pub objects: Vec<ObjectEntry>,
    pub next_token: Option<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObjectVersion {
    pub key: String,
    pub version_id: String,
    pub is_latest: bool,
    pub delete_marker: bool,
    pub size: u64,
    pub last_modified: Option<String>,
    pub etag: Option<String>,
    pub storage_class: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct VersionListing {
    pub prefixes: Vec<String>,
    pub versions: Vec<ObjectVersion>,
    pub next_key_marker: Option<String>,
    pub next_version_marker: Option<String>,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObjectHead {
    pub key: String,
    pub version_id: Option<String>,
    pub size: u64,
    pub content_type: Option<String>,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub storage_class: String,
    pub cache_control: Option<String>,
    pub content_disposition: Option<String>,
    pub content_encoding: Option<String>,
    pub content_language: Option<String>,
    pub expires: Option<String>,
    pub server_side_encryption: Option<String>,
    pub kms_key_id: Option<String>,
    pub retention_mode: Option<String>,
    pub retain_until: Option<String>,
    pub legal_hold: Option<String>,
    pub tag_count: u32,
    pub replication_status: Option<String>,
    pub metadata: BTreeMap<String, String>,
    pub headers: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ObjectPreview {
    pub content_type: Option<String>,
    pub size: u64,
    pub truncated: bool,
    pub data: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ObjectRef {
    pub key: String,
    #[serde(default)]
    pub version_id: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct DeleteOutcome {
    pub deleted: usize,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct ObjectProperties {
    #[serde(default)]
    pub content_type: Option<String>,
    #[serde(default)]
    pub cache_control: Option<String>,
    #[serde(default)]
    pub content_disposition: Option<String>,
    #[serde(default)]
    pub content_encoding: Option<String>,
    #[serde(default)]
    pub content_language: Option<String>,
    #[serde(default)]
    pub expires: Option<String>,
    #[serde(default)]
    pub storage_class: Option<String>,
    #[serde(default)]
    pub server_side_encryption: Option<String>,
    #[serde(default)]
    pub kms_key_id: Option<String>,
    #[serde(default)]
    pub metadata: BTreeMap<String, String>,
}

impl ObjectProperties {
    pub fn headers(&self) -> Vec<(String, String)> {
        let mut out = Vec::new();
        let mut push = |name: &str, value: &Option<String>| {
            if let Some(v) = value.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
                out.push((name.to_string(), v.to_string()));
            }
        };
        push("content-type", &self.content_type);
        push("cache-control", &self.cache_control);
        push("content-disposition", &self.content_disposition);
        push("content-encoding", &self.content_encoding);
        push("content-language", &self.content_language);
        push("expires", &self.expires);
        push("x-amz-storage-class", &self.storage_class);
        push("x-amz-server-side-encryption", &self.server_side_encryption);
        push(
            "x-amz-server-side-encryption-aws-kms-key-id",
            &self.kms_key_id,
        );
        for (k, v) in &self.metadata {
            let name = k.trim().to_ascii_lowercase();
            if !name.is_empty() {
                out.push((format!("x-amz-meta-{name}"), v.trim().to_string()));
            }
        }
        out
    }
}

impl From<&ObjectHead> for ObjectProperties {
    fn from(head: &ObjectHead) -> Self {
        Self {
            content_type: head.content_type.clone(),
            cache_control: head.cache_control.clone(),
            content_disposition: head.content_disposition.clone(),
            content_encoding: head.content_encoding.clone(),
            content_language: head.content_language.clone(),
            expires: head.expires.clone(),
            storage_class: Some(head.storage_class.clone()).filter(|c| c != "STANDARD"),
            server_side_encryption: head.server_side_encryption.clone(),
            kms_key_id: head.kms_key_id.clone(),
            metadata: head.metadata.clone(),
        }
    }
}

pub fn tagging_query(xml_text: &str) -> Result<String, String> {
    let root = xml::parse(xml_text)?;
    let tags = root
        .child("TagSet")
        .map(|set| {
            set.all("Tag")
                .map(|tag| {
                    format!(
                        "{}={}",
                        uri_encode(&tag.text_of("Key").unwrap_or_default(), false),
                        uri_encode(&tag.text_of("Value").unwrap_or_default(), false)
                    )
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    Ok(tags.join("&"))
}

#[derive(Debug, Clone, Serialize)]
pub struct MultipartUpload {
    pub key: String,
    pub upload_id: String,
    pub initiated: Option<String>,
    pub storage_class: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct BucketStats {
    pub objects: u64,
    pub bytes: u64,
    pub truncated: bool,
    pub storage_classes: BTreeMap<String, u64>,
}

pub const BUCKET_RESOURCES: &[&str] = &[
    "policy",
    "policyStatus",
    "lifecycle",
    "cors",
    "encryption",
    "tagging",
    "object-lock",
    "notification",
    "replication",
    "versioning",
    "website",
    "logging",
    "acl",
    "accelerate",
    "requestPayment",
    "ownershipControls",
    "publicAccessBlock",
    "location",
];

pub const OBJECT_RESOURCES: &[&str] = &["tagging", "retention", "legal-hold", "acl"];

fn size_of(node: &Node) -> u64 {
    node.text_of("Size")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}

fn entry(node: &Node) -> ObjectEntry {
    ObjectEntry {
        key: node.text_of("Key").unwrap_or_default(),
        size: size_of(node),
        last_modified: node.text_of("LastModified"),
        etag: node.text_of("ETag"),
        storage_class: node.text_of("StorageClass"),
    }
}

fn prefixes(root: &Node) -> Vec<String> {
    root.all("CommonPrefixes")
        .filter_map(|p| p.text_of("Prefix"))
        .collect()
}

fn header(response: &reqwest::Response, name: &str) -> Option<String> {
    response
        .headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string)
}

pub fn validate_bucket_name(name: &str) -> Result<(), String> {
    let valid_chars = name
        .chars()
        .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '.');
    let edges = name
        .chars()
        .next()
        .zip(name.chars().last())
        .is_some_and(|(a, b)| a.is_ascii_alphanumeric() && b.is_ascii_alphanumeric());
    if !(3..=63).contains(&name.len()) || !valid_chars || !edges || name.contains("..") {
        return Err("Bucket-Namen: 3–63 Zeichen, Kleinbuchstaben, Ziffern, Punkt und Bindestrich; Anfang und Ende alphanumerisch.".to_string());
    }
    if name.split('.').count() == 4 && name.split('.').all(|p| p.parse::<u8>().is_ok()) {
        return Err("Bucket-Namen dürfen keine IP-Adresse sein.".to_string());
    }
    Ok(())
}

fn check_resource(resource: &str, allowed: &[&str]) -> Result<(), String> {
    if allowed.contains(&resource) {
        Ok(())
    } else {
        Err(format!("Unbekannte S3-Konfiguration: {resource}"))
    }
}

pub fn parent_prefix(key: &str) -> &str {
    let trimmed = key.trim_end_matches('/');
    match trimmed.rfind('/') {
        Some(i) => &key[..=i],
        None => "",
    }
}

impl S3 {
    pub async fn list_buckets(&self) -> Result<Vec<BucketInfo>, String> {
        let root = match self.xml(Request::new(Method::GET, None, None)).await {
            Ok(root) => root,
            Err(e) if e.code == "AccessDenied" && self.default_bucket.is_some() => {
                return Ok(vec![BucketInfo {
                    name: self.default_bucket.clone().unwrap_or_default(),
                    creation_date: None,
                }])
            }
            Err(e) => return Err(e.into()),
        };
        let mut buckets: Vec<BucketInfo> = root
            .child("Buckets")
            .map(|b| {
                b.all("Bucket")
                    .map(|n| BucketInfo {
                        name: n.text_of("Name").unwrap_or_default(),
                        creation_date: n.text_of("CreationDate"),
                    })
                    .collect()
            })
            .unwrap_or_default();
        if let Some(default) = &self.default_bucket {
            buckets.retain(|b| &b.name == default);
            if buckets.is_empty() {
                buckets.push(BucketInfo {
                    name: default.clone(),
                    creation_date: None,
                });
            }
        }
        buckets.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(buckets)
    }

    pub async fn head_bucket(&self, bucket: &str) -> Result<(), String> {
        self.send(Request::new(Method::HEAD, Some(bucket), None))
            .await
            .map(|_| ())
            .map_err(Into::into)
    }

    pub async fn create_bucket(
        &self,
        bucket: &str,
        region: Option<&str>,
        object_lock: bool,
    ) -> Result<(), String> {
        validate_bucket_name(bucket)?;
        let region = region
            .map(str::trim)
            .filter(|r| !r.is_empty())
            .unwrap_or(self.region());
        let mut req = Request::new(Method::PUT, Some(bucket), None);
        if region != "us-east-1" && region != "auto" {
            req = req.xml(
                format!(
                    "<CreateBucketConfiguration xmlns=\"{S3_XMLNS}\"><LocationConstraint>{}</LocationConstraint></CreateBucketConfiguration>",
                    xml::escape(region)
                ),
                "application/xml",
            );
        }
        if object_lock {
            req = req.header("x-amz-bucket-object-lock-enabled", "true");
        }
        self.send(req).await.map(|_| ()).map_err(Into::into)
    }

    pub async fn delete_bucket(&self, bucket: &str, force: bool) -> Result<(), String> {
        if force {
            self.empty_bucket(bucket).await?;
        }
        self.send(Request::new(Method::DELETE, Some(bucket), None))
            .await
            .map(|_| ())
            .map_err(Into::into)
    }

    async fn empty_bucket(&self, bucket: &str) -> Result<(), String> {
        for upload in self
            .list_multipart_uploads(bucket)
            .await
            .unwrap_or_default()
        {
            self.abort_multipart(bucket, &upload.key, &upload.upload_id)
                .await?;
        }
        let outcome = self.delete_prefix(bucket, "", true, true).await?;
        if let Some(error) = outcome.errors.first() {
            return Err(format!(
                "{} Objekt(e) konnten nicht gelöscht werden: {error}",
                outcome.errors.len()
            ));
        }
        Ok(())
    }

    pub async fn list_objects(
        &self,
        bucket: &str,
        prefix: &str,
        delimiter: Option<&str>,
        token: Option<&str>,
        max_keys: Option<u32>,
    ) -> Result<ObjectListing, String> {
        let req = Request::new(Method::GET, Some(bucket), None)
            .query("list-type", "2")
            .query("prefix", prefix)
            .query(
                "max-keys",
                max_keys.unwrap_or(1000).clamp(1, 1000).to_string(),
            )
            .query_opt("delimiter", delimiter)
            .query_opt("continuation-token", token);
        let root = self.xml(req).await?;
        let truncated = root.text_of("IsTruncated").as_deref() == Some("true");
        Ok(ObjectListing {
            prefixes: prefixes(&root),
            objects: root.all("Contents").map(entry).collect(),
            next_token: root
                .text_of("NextContinuationToken")
                .filter(|t| truncated && !t.is_empty()),
            truncated,
        })
    }

    pub async fn for_each_object(
        &self,
        bucket: &str,
        prefix: &str,
        mut visit: impl FnMut(ObjectEntry) -> bool,
    ) -> Result<bool, String> {
        let mut token: Option<String> = None;
        loop {
            if super::super::execution::cancellation_token().is_cancelled() {
                return Err("Abgebrochen".to_string());
            }
            let page = self
                .list_objects(bucket, prefix, None, token.as_deref(), None)
                .await?;
            for object in page.objects {
                if !visit(object) {
                    return Ok(true);
                }
            }
            match page.next_token {
                Some(next) => token = Some(next),
                None => return Ok(false),
            }
        }
    }

    pub async fn list_versions(
        &self,
        bucket: &str,
        prefix: &str,
        delimiter: Option<&str>,
        key_marker: Option<&str>,
        version_marker: Option<&str>,
        max_keys: Option<u32>,
    ) -> Result<VersionListing, String> {
        let req = Request::new(Method::GET, Some(bucket), None)
            .query("versions", "")
            .query("prefix", prefix)
            .query(
                "max-keys",
                max_keys.unwrap_or(1000).clamp(1, 1000).to_string(),
            )
            .query_opt("delimiter", delimiter)
            .query_opt("key-marker", key_marker)
            .query_opt("version-id-marker", version_marker);
        let root = self.xml(req).await?;
        let truncated = root.text_of("IsTruncated").as_deref() == Some("true");
        let versions = root
            .children
            .iter()
            .filter(|n| n.name == "Version" || n.name == "DeleteMarker")
            .map(|n| ObjectVersion {
                key: n.text_of("Key").unwrap_or_default(),
                version_id: n.text_of("VersionId").unwrap_or_else(|| "null".into()),
                is_latest: n.text_of("IsLatest").as_deref() == Some("true"),
                delete_marker: n.name == "DeleteMarker",
                size: size_of(n),
                last_modified: n.text_of("LastModified"),
                etag: n.text_of("ETag"),
                storage_class: n.text_of("StorageClass"),
            })
            .collect();
        Ok(VersionListing {
            prefixes: prefixes(&root),
            versions,
            next_key_marker: root
                .text_of("NextKeyMarker")
                .filter(|m| truncated && !m.is_empty()),
            next_version_marker: root
                .text_of("NextVersionIdMarker")
                .filter(|m| truncated && !m.is_empty()),
            truncated,
        })
    }

    pub async fn head_object(
        &self,
        bucket: &str,
        key: &str,
        version_id: Option<&str>,
    ) -> Result<ObjectHead, String> {
        self.try_head_object(bucket, key, version_id)
            .await
            .map_err(|e| match e.status {
                404 => format!("Objekt nicht gefunden: {key}"),
                405 => format!("{key} ist in dieser Version ein Delete-Marker."),
                _ => e.to_string(),
            })
    }

    async fn try_head_object(
        &self,
        bucket: &str,
        key: &str,
        version_id: Option<&str>,
    ) -> Result<ObjectHead, S3Error> {
        let response = self
            .send(
                Request::new(Method::HEAD, Some(bucket), Some(key))
                    .query_opt("versionId", version_id),
            )
            .await?;
        let mut headers = BTreeMap::new();
        let mut metadata = BTreeMap::new();
        for (name, value) in response.headers() {
            let value = value.to_str().unwrap_or_default().to_string();
            if let Some(meta) = name.as_str().strip_prefix("x-amz-meta-") {
                metadata.insert(meta.to_string(), value.clone());
            }
            headers.insert(name.as_str().to_string(), value);
        }
        let get = |name: &str| header(&response, name);
        Ok(ObjectHead {
            key: key.to_string(),
            version_id: get("x-amz-version-id").filter(|v| v != "null"),
            size: get("content-length")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            content_type: get("content-type"),
            etag: get("etag"),
            last_modified: get("last-modified"),
            storage_class: get("x-amz-storage-class").unwrap_or_else(|| "STANDARD".into()),
            cache_control: get("cache-control"),
            content_disposition: get("content-disposition"),
            content_encoding: get("content-encoding"),
            content_language: get("content-language"),
            expires: get("expires"),
            server_side_encryption: get("x-amz-server-side-encryption"),
            kms_key_id: get("x-amz-server-side-encryption-aws-kms-key-id"),
            retention_mode: get("x-amz-object-lock-mode"),
            retain_until: get("x-amz-object-lock-retain-until-date"),
            legal_hold: get("x-amz-object-lock-legal-hold"),
            tag_count: get("x-amz-tagging-count")
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
            replication_status: get("x-amz-replication-status"),
            metadata,
            headers,
        })
    }

    pub async fn get_range(
        &self,
        bucket: &str,
        key: &str,
        version_id: Option<&str>,
        max_bytes: u64,
    ) -> Result<(Option<String>, u64, Vec<u8>), String> {
        let mut req =
            Request::new(Method::GET, Some(bucket), Some(key)).query_opt("versionId", version_id);
        if max_bytes > 0 {
            req = req.header("range", format!("bytes=0-{}", max_bytes - 1));
        }
        let response = match self.send(req).await {
            Ok(r) => r,
            Err(e) if e.code == "InvalidRange" => {
                return Ok((None, 0, Vec::new()));
            }
            Err(e) => return Err(e.into()),
        };
        let content_type = header(&response, "content-type");
        let total = header(&response, "content-range")
            .and_then(|r| r.rsplit('/').next().and_then(|t| t.parse().ok()))
            .or_else(|| header(&response, "content-length").and_then(|v| v.parse().ok()))
            .unwrap_or(0);
        let bytes = response
            .bytes()
            .await
            .map_err(|e| format!("Objekt konnte nicht gelesen werden: {e}"))?;
        Ok((content_type, total, bytes.to_vec()))
    }

    pub async fn preview(
        &self,
        bucket: &str,
        key: &str,
        version_id: Option<&str>,
        max_bytes: u64,
    ) -> Result<ObjectPreview, String> {
        use base64::Engine;
        let limit = max_bytes.clamp(1, MAX_PREVIEW_BYTES);
        let (content_type, size, bytes) = self.get_range(bucket, key, version_id, limit).await?;
        Ok(ObjectPreview {
            content_type,
            size,
            truncated: (bytes.len() as u64) < size,
            data: base64::engine::general_purpose::STANDARD.encode(bytes),
        })
    }

    pub async fn get_text(&self, bucket: &str, key: &str) -> Result<String, String> {
        let (_, size, bytes) = self
            .get_range(bucket, key, None, MAX_TEXT_BYTES + 1)
            .await?;
        if size > MAX_TEXT_BYTES {
            return Err(format!(
                "Objekt ist zu groß für den Editor ({size} Bytes, maximal {MAX_TEXT_BYTES})."
            ));
        }
        String::from_utf8(bytes).map_err(|_| "Objekt ist kein UTF-8-Text.".to_string())
    }

    pub async fn put_bytes(
        &self,
        bucket: &str,
        key: &str,
        body: Vec<u8>,
        headers: &[(String, String)],
    ) -> Result<Option<String>, String> {
        let mut req = Request::new(Method::PUT, Some(bucket), Some(key))
            .body(body)
            .no_timeout();
        for (name, value) in headers {
            req = req.header(name, value.clone());
        }
        let response = self.send(req.with_md5()).await?;
        Ok(header(&response, "x-amz-version-id"))
    }

    pub async fn replace_text(
        &self,
        bucket: &str,
        key: &str,
        text: String,
        content_type: Option<String>,
        fallback_type: &str,
    ) -> Result<Option<String>, String> {
        let (mut props, tagging) = match self.try_head_object(bucket, key, None).await {
            Ok(head) => {
                let tagging = if head.tag_count > 0 {
                    match self.get_config(bucket, Some(key), None, "tagging").await? {
                        Some(xml_text) => Some(tagging_query(&xml_text)?),
                        None => None,
                    }
                } else {
                    None
                };
                (ObjectProperties::from(&head), tagging)
            }
            Err(e) if e.status == 404 || e.status == 405 => (ObjectProperties::default(), None),
            Err(e) => return Err(e.into()),
        };
        if let Some(c) = content_type.filter(|c| !c.trim().is_empty()) {
            props.content_type = Some(c);
        }
        if props.content_type.is_none() {
            props.content_type = Some(fallback_type.to_string());
        }
        let mut headers = props.headers();
        if let Some(tagging) = tagging.filter(|t| !t.is_empty()) {
            headers.push(("x-amz-tagging".to_string(), tagging));
        }
        self.put_bytes(bucket, key, text.into_bytes(), &headers)
            .await
    }

    pub async fn create_folder(&self, bucket: &str, key: &str) -> Result<(), String> {
        let key = format!("{}/", key.trim_matches('/'));
        if key == "/" {
            return Err("Der Ordnername darf nicht leer sein.".to_string());
        }
        self.put_bytes(
            bucket,
            &key,
            Vec::new(),
            &[("content-type".into(), "application/x-directory".into())],
        )
        .await
        .map(|_| ())
    }

    pub async fn delete_objects(
        &self,
        bucket: &str,
        objects: &[ObjectRef],
        bypass_governance: bool,
    ) -> Result<DeleteOutcome, String> {
        let mut outcome = DeleteOutcome::default();
        for batch in objects.chunks(1000) {
            let body: String = batch
                .iter()
                .map(
                    |o| match o.version_id.as_deref().filter(|v| !v.is_empty()) {
                        Some(v) => format!(
                            "<Object><Key>{}</Key><VersionId>{}</VersionId></Object>",
                            xml::escape(&o.key),
                            xml::escape(v)
                        ),
                        None => format!("<Object><Key>{}</Key></Object>", xml::escape(&o.key)),
                    },
                )
                .collect();
            let mut req = Request::new(Method::POST, Some(bucket), None)
                .query("delete", "")
                .xml(
                    format!("<Delete xmlns=\"{S3_XMLNS}\"><Quiet>true</Quiet>{body}</Delete>"),
                    "application/xml",
                );
            if bypass_governance {
                req = req.header("x-amz-bypass-governance-retention", "true");
            }
            let root = self.xml(req).await?;
            let errors: Vec<String> = root
                .all("Error")
                .map(|e| {
                    format!(
                        "{}: {} {}",
                        e.text_of("Key").unwrap_or_default(),
                        e.text_of("Code").unwrap_or_default(),
                        e.text_of("Message").unwrap_or_default()
                    )
                })
                .collect();
            outcome.deleted += batch.len() - errors.len();
            outcome.errors.extend(errors);
        }
        Ok(outcome)
    }

    pub async fn delete_prefix(
        &self,
        bucket: &str,
        prefix: &str,
        all_versions: bool,
        bypass_governance: bool,
    ) -> Result<DeleteOutcome, String> {
        let mut refs = Vec::new();
        if all_versions {
            let (mut key_marker, mut version_marker) = (None::<String>, None::<String>);
            loop {
                let page = self
                    .list_versions(
                        bucket,
                        prefix,
                        None,
                        key_marker.as_deref(),
                        version_marker.as_deref(),
                        None,
                    )
                    .await?;
                refs.extend(page.versions.into_iter().map(|v| ObjectRef {
                    key: v.key,
                    version_id: Some(v.version_id),
                }));
                if !page.truncated {
                    break;
                }
                key_marker = page.next_key_marker;
                version_marker = page.next_version_marker;
                if key_marker.is_none() {
                    break;
                }
            }
        } else {
            self.for_each_object(bucket, prefix, |o| {
                refs.push(ObjectRef {
                    key: o.key,
                    version_id: None,
                });
                true
            })
            .await?;
        }
        self.delete_objects(bucket, &refs, bypass_governance).await
    }

    pub async fn copy_object(
        &self,
        source_bucket: &str,
        source_key: &str,
        source_version: Option<&str>,
        bucket: &str,
        key: &str,
        replace: Option<&ObjectProperties>,
    ) -> Result<(), String> {
        let mut source = format!(
            "/{}/{}",
            super::client::uri_encode(source_bucket, false),
            super::client::uri_encode(source_key, true)
        );
        if let Some(v) = source_version.filter(|v| !v.is_empty()) {
            source.push_str(&format!(
                "?versionId={}",
                super::client::uri_encode(v, false)
            ));
        }
        let mut req = Request::new(Method::PUT, Some(bucket), Some(key))
            .header("x-amz-copy-source", source)
            .no_timeout();
        if let Some(props) = replace {
            req = req.header("x-amz-metadata-directive", "REPLACE");
            for (name, value) in props.headers() {
                req = req.header(&name, value);
            }
        }
        let text = self.text(req).await?;
        if let Ok(root) = xml::parse(&text) {
            if root.name == "Error" {
                return Err(S3Error {
                    status: 200,
                    code: root.text_of("Code").unwrap_or_default(),
                    message: root.text_of("Message").unwrap_or_default(),
                }
                .into());
            }
        }
        Ok(())
    }

    pub async fn update_properties(
        &self,
        bucket: &str,
        key: &str,
        props: &ObjectProperties,
    ) -> Result<(), String> {
        let current = self.head_object(bucket, key, None).await?;
        let mut props = props.clone();
        if props.storage_class.is_none() && current.storage_class != "STANDARD" {
            props.storage_class = Some(current.storage_class.clone());
        }
        if props.server_side_encryption.is_none() {
            props.server_side_encryption = current.server_side_encryption.clone();
            props.kms_key_id = current.kms_key_id.clone();
        }
        self.copy_object(bucket, key, None, bucket, key, Some(&props))
            .await
    }

    fn resource_request<'a>(
        &self,
        method: Method,
        bucket: &'a str,
        key: Option<&'a str>,
        version_id: Option<&str>,
        resource: &str,
    ) -> Result<Request<'a>, String> {
        check_resource(
            resource,
            if key.is_some() {
                OBJECT_RESOURCES
            } else {
                BUCKET_RESOURCES
            },
        )?;
        Ok(Request::new(method, Some(bucket), key)
            .query(resource, "")
            .query_opt("versionId", version_id))
    }

    pub async fn get_config(
        &self,
        bucket: &str,
        key: Option<&str>,
        version_id: Option<&str>,
        resource: &str,
    ) -> Result<Option<String>, String> {
        let req = self.resource_request(Method::GET, bucket, key, version_id, resource)?;
        match self.text(req).await {
            Ok(text) => Ok(Some(text)),
            Err(e) if e.is_missing() && e.code != "NoSuchBucket" && e.code != "NoSuchKey" => {
                Ok(None)
            }
            Err(e) => Err(e.into()),
        }
    }

    pub async fn put_config(
        &self,
        bucket: &str,
        key: Option<&str>,
        version_id: Option<&str>,
        resource: &str,
        body: String,
        bypass_governance: bool,
    ) -> Result<(), String> {
        let content_type = if resource == "policy" {
            "application/json"
        } else {
            "application/xml"
        };
        let mut req = self
            .resource_request(Method::PUT, bucket, key, version_id, resource)?
            .xml(body, content_type);
        if bypass_governance {
            req = req.header("x-amz-bypass-governance-retention", "true");
        }
        self.send(req).await.map(|_| ()).map_err(Into::into)
    }

    pub async fn delete_config(
        &self,
        bucket: &str,
        key: Option<&str>,
        version_id: Option<&str>,
        resource: &str,
    ) -> Result<(), String> {
        let req = self.resource_request(Method::DELETE, bucket, key, version_id, resource)?;
        match self.send(req).await {
            Ok(_) => Ok(()),
            Err(e) if e.is_missing() && e.code != "NoSuchBucket" => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    pub async fn list_multipart_uploads(
        &self,
        bucket: &str,
    ) -> Result<Vec<MultipartUpload>, String> {
        let mut uploads = Vec::new();
        let (mut key_marker, mut id_marker) = (None::<String>, None::<String>);
        loop {
            let req = Request::new(Method::GET, Some(bucket), None)
                .query("uploads", "")
                .query_opt("key-marker", key_marker.as_deref())
                .query_opt("upload-id-marker", id_marker.as_deref());
            let root = self.xml(req).await?;
            uploads.extend(root.all("Upload").map(|u| MultipartUpload {
                key: u.text_of("Key").unwrap_or_default(),
                upload_id: u.text_of("UploadId").unwrap_or_default(),
                initiated: u.text_of("Initiated"),
                storage_class: u.text_of("StorageClass"),
            }));
            if root.text_of("IsTruncated").as_deref() != Some("true") {
                return Ok(uploads);
            }
            key_marker = root.text_of("NextKeyMarker").filter(|m| !m.is_empty());
            id_marker = root.text_of("NextUploadIdMarker").filter(|m| !m.is_empty());
            if key_marker.is_none() {
                return Ok(uploads);
            }
        }
    }

    pub async fn abort_multipart(
        &self,
        bucket: &str,
        key: &str,
        upload_id: &str,
    ) -> Result<(), String> {
        self.send(
            Request::new(Method::DELETE, Some(bucket), Some(key)).query("uploadId", upload_id),
        )
        .await
        .map(|_| ())
        .map_err(Into::into)
    }

    pub async fn bucket_stats(&self, bucket: &str, prefix: &str) -> Result<BucketStats, String> {
        const CAP: u64 = 1_000_000;
        let mut stats = BucketStats::default();
        let truncated = self
            .for_each_object(bucket, prefix, |o| {
                stats.objects += 1;
                stats.bytes += o.size;
                *stats
                    .storage_classes
                    .entry(o.storage_class.unwrap_or_else(|| "STANDARD".into()))
                    .or_default() += o.size;
                stats.objects < CAP
            })
            .await?;
        stats.truncated = truncated;
        Ok(stats)
    }

    pub async fn search(
        &self,
        bucket: &str,
        prefix: &str,
        needle: &str,
        limit: usize,
    ) -> Result<(Vec<ObjectEntry>, bool), String> {
        const SCAN_CAP: usize = 500_000;
        let needle = needle.to_lowercase();
        let mut hits = Vec::new();
        let mut scanned = 0usize;
        let truncated = self
            .for_each_object(bucket, prefix, |o| {
                scanned += 1;
                let name = o.key.rsplit('/').find(|p| !p.is_empty()).unwrap_or(&o.key);
                if name.to_lowercase().contains(&needle) || o.key.to_lowercase().contains(&needle) {
                    hits.push(o);
                }
                hits.len() < limit && scanned < SCAN_CAP
            })
            .await?;
        Ok((hits, truncated))
    }

    pub async fn keys_under(&self, bucket: &str, prefix: &str) -> Result<Vec<ObjectEntry>, String> {
        let mut out = Vec::new();
        self.for_each_object(bucket, prefix, |o| {
            out.push(o);
            true
        })
        .await?;
        Ok(out)
    }

    pub async fn copy_items(
        &self,
        source_bucket: &str,
        items: &[TransferItem],
        bucket: &str,
        destination_prefix: &str,
        move_items: bool,
    ) -> Result<DeleteOutcome, String> {
        let mut plan: Vec<(String, Option<String>, String)> = Vec::new();
        for item in items {
            let base = parent_prefix(&item.key);
            if item.is_prefix {
                for object in self.keys_under(source_bucket, &item.key).await? {
                    let relative = &object.key[base.len()..];
                    plan.push((
                        object.key.clone(),
                        None,
                        format!("{destination_prefix}{relative}"),
                    ));
                }
            } else {
                let relative = &item.key[base.len()..];
                plan.push((
                    item.key.clone(),
                    item.version_id.clone(),
                    format!("{destination_prefix}{relative}"),
                ));
            }
        }
        if plan
            .iter()
            .any(|(source, _, target)| source_bucket == bucket && source == target)
        {
            return Err("Quelle und Ziel sind identisch.".to_string());
        }
        let mut outcome = DeleteOutcome::default();
        let mut copied = Vec::new();
        for (source, version, target) in &plan {
            match self
                .copy_object(
                    source_bucket,
                    source,
                    version.as_deref(),
                    bucket,
                    target,
                    None,
                )
                .await
            {
                Ok(()) => {
                    outcome.deleted += 1;
                    copied.push(ObjectRef {
                        key: source.clone(),
                        version_id: None,
                    });
                }
                Err(e) => outcome.errors.push(format!("{source}: {e}")),
            }
        }
        if move_items && !copied.is_empty() {
            let removed = self.delete_objects(source_bucket, &copied, false).await?;
            outcome.errors.extend(removed.errors);
        }
        Ok(outcome)
    }

    pub async fn rename(
        &self,
        bucket: &str,
        from: &str,
        to: &str,
    ) -> Result<DeleteOutcome, String> {
        let to = to.trim_start_matches('/');
        if to.is_empty() || to == from {
            return Err("Der neue Name ist leer oder unverändert.".to_string());
        }
        if from.ends_with('/') {
            let target = format!("{}/", to.trim_end_matches('/'));
            if target.starts_with(from) {
                return Err("Ein Ordner kann nicht in sich selbst verschoben werden.".to_string());
            }
            let mut outcome = DeleteOutcome::default();
            let mut copied = Vec::new();
            for object in self.keys_under(bucket, from).await? {
                let new_key = format!("{target}{}", &object.key[from.len()..]);
                match self
                    .copy_object(bucket, &object.key, None, bucket, &new_key, None)
                    .await
                {
                    Ok(()) => {
                        outcome.deleted += 1;
                        copied.push(ObjectRef {
                            key: object.key,
                            version_id: None,
                        });
                    }
                    Err(e) => outcome.errors.push(format!("{}: {e}", object.key)),
                }
            }
            if outcome.errors.is_empty() {
                let removed = self.delete_objects(bucket, &copied, false).await?;
                outcome.errors.extend(removed.errors);
            }
            return Ok(outcome);
        }
        self.copy_object(bucket, from, None, bucket, to, None)
            .await?;
        let removed = self
            .delete_objects(
                bucket,
                &[ObjectRef {
                    key: from.to_string(),
                    version_id: None,
                }],
                false,
            )
            .await?;
        Ok(DeleteOutcome {
            deleted: 1,
            errors: removed.errors,
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct TransferItem {
    pub key: String,
    #[serde(default)]
    pub version_id: Option<String>,
    #[serde(default)]
    pub is_prefix: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_bucket_names() {
        assert!(validate_bucket_name("my-bucket.01").is_ok());
        assert!(validate_bucket_name("ab").is_err());
        assert!(validate_bucket_name("Upper").is_err());
        assert!(validate_bucket_name("-x-y").is_err());
        assert!(validate_bucket_name("a..b").is_err());
        assert!(validate_bucket_name("192.168.1.1").is_err());
    }

    #[test]
    fn computes_parent_prefix() {
        assert_eq!(parent_prefix("a/b/c.txt"), "a/b/");
        assert_eq!(parent_prefix("a/b/"), "a/");
        assert_eq!(parent_prefix("file.txt"), "");
        assert_eq!(parent_prefix("dir/"), "");
    }

    #[test]
    fn maps_properties_to_headers() {
        let mut props = ObjectProperties {
            content_type: Some("text/plain".into()),
            cache_control: Some("  ".into()),
            ..Default::default()
        };
        props.metadata.insert("Owner".into(), "l8db".into());
        let headers = props.headers();
        assert!(headers.contains(&("content-type".into(), "text/plain".into())));
        assert!(headers.contains(&("x-amz-meta-owner".into(), "l8db".into())));
        assert!(!headers.iter().any(|(k, _)| k == "cache-control"));
    }
}
