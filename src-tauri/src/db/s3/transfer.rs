use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use futures_util::{stream, StreamExt, TryStreamExt};
use reqwest::Method;
use serde::Serialize;
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;

use super::client::{Request, S3};
use super::ops::{parent_prefix, ObjectProperties, TransferItem};
use super::xml;

pub const PART_SIZE: u64 = 8 * 1024 * 1024;
const FILE_CONCURRENCY: usize = 4;
const PART_CONCURRENCY: usize = 3;
const CANCELLED: &str = "Übertragung abgebrochen";

#[derive(Debug, Clone, Serialize)]
pub struct TransferEvent {
    pub id: String,
    pub direction: &'static str,
    pub state: &'static str,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub files_done: usize,
    pub files_total: usize,
    pub current: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct TransferSummary {
    pub files: usize,
    pub bytes: u64,
    pub errors: Vec<String>,
    pub cancelled: bool,
}

pub type Emit = Arc<dyn Fn(TransferEvent) + Send + Sync>;

struct Tracker {
    id: String,
    direction: &'static str,
    bytes_total: AtomicU64,
    files_total: usize,
    bytes_done: AtomicU64,
    files_done: AtomicUsize,
    current: Mutex<Option<String>>,
    last_emit: Mutex<Instant>,
    emit: Emit,
}

impl Tracker {
    fn event(&self, state: &'static str, error: Option<String>) -> TransferEvent {
        TransferEvent {
            id: self.id.clone(),
            direction: self.direction,
            state,
            bytes_done: self.bytes_done.load(Ordering::Relaxed),
            bytes_total: self.bytes_total.load(Ordering::Relaxed),
            files_done: self.files_done.load(Ordering::Relaxed),
            files_total: self.files_total,
            current: self.current.lock().ok().and_then(|c| c.clone()),
            error,
        }
    }

    fn tick(&self) {
        let due = self
            .last_emit
            .lock()
            .map(|mut last| {
                let due = last.elapsed() >= Duration::from_millis(120);
                if due {
                    *last = Instant::now();
                }
                due
            })
            .unwrap_or(false);
        if due {
            (self.emit)(self.event("running", None));
        }
    }

    fn add(&self, bytes: u64) {
        self.bytes_done.fetch_add(bytes, Ordering::Relaxed);
        self.tick();
    }

    fn start(&self, name: &str) {
        if let Ok(mut current) = self.current.lock() {
            *current = Some(name.to_string());
        }
        self.tick();
    }

    fn file_done(&self) {
        self.files_done.fetch_add(1, Ordering::Relaxed);
        self.tick();
    }

    fn finish(&self, summary: &TransferSummary) {
        let state = if summary.cancelled {
            "cancelled"
        } else if summary.errors.is_empty() {
            "done"
        } else {
            "error"
        };
        (self.emit)(self.event(state, summary.errors.first().cloned()));
    }
}

fn registry() -> &'static Mutex<HashMap<String, CancellationToken>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, CancellationToken>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

struct Registration(String);

impl Drop for Registration {
    fn drop(&mut self) {
        if let Ok(mut entries) = registry().lock() {
            entries.remove(&self.0);
        }
    }
}

fn register(id: &str) -> (Registration, CancellationToken) {
    let token = CancellationToken::new();
    if let Ok(mut entries) = registry().lock() {
        entries.insert(id.to_string(), token.clone());
    }
    (Registration(id.to_string()), token)
}

pub fn cancel(id: &str) -> bool {
    registry()
        .lock()
        .ok()
        .and_then(|entries| entries.get(id).cloned())
        .map(|token| token.cancel())
        .is_some()
}

pub fn guess_content_type(name: &str) -> &'static str {
    let lower = name.to_ascii_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or_default();
    match ext {
        "txt" | "log" => "text/plain",
        "md" | "markdown" => "text/markdown",
        "csv" => "text/csv",
        "tsv" => "text/tab-separated-values",
        "json" => "application/json",
        "jsonl" | "ndjson" => "application/x-ndjson",
        "xml" => "application/xml",
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" => "text/javascript",
        "ts" => "text/x-typescript",
        "yaml" | "yml" => "application/yaml",
        "toml" => "application/toml",
        "sql" => "application/sql",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "gz" | "tgz" => "application/gzip",
        "tar" => "application/x-tar",
        "parquet" => "application/vnd.apache.parquet",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

pub fn safe_join(base: &Path, relative: &str) -> Result<PathBuf, String> {
    let mut path = base.to_path_buf();
    let mut pushed = false;
    for segment in relative.split('/') {
        match segment {
            "" | "." => continue,
            ".." => return Err(format!("Unsicherer Objektschlüssel: {relative}")),
            s => {
                let clean: String = s
                    .chars()
                    .map(|c| {
                        if matches!(c, '<' | '>' | ':' | '"' | '\\' | '|' | '?' | '*')
                            || c.is_control()
                        {
                            '_'
                        } else {
                            c
                        }
                    })
                    .collect();
                path.push(clean);
                pushed = true;
            }
        }
    }
    if pushed {
        Ok(path)
    } else {
        Err(format!("Leerer Objektschlüssel: {relative}"))
    }
}

fn collect(
    path: &Path,
    key_base: &str,
    out: &mut Vec<(PathBuf, String, u64)>,
) -> Result<(), String> {
    let meta = std::fs::metadata(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| format!("Ungültiger Pfad: {}", path.display()))?;
    if meta.is_dir() {
        let mut entries: Vec<PathBuf> = std::fs::read_dir(path)
            .map_err(|e| format!("{}: {e}", path.display()))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .collect();
        entries.sort();
        let base = format!("{key_base}{name}/");
        for entry in entries {
            collect(&entry, &base, out)?;
        }
    } else if meta.is_file() {
        out.push((path.to_path_buf(), format!("{key_base}{name}"), meta.len()));
    }
    Ok(())
}

fn read_chunk(path: &Path, offset: u64, len: u64) -> Result<Vec<u8>, String> {
    let mut file = std::fs::File::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("{}: {e}", path.display()))?;
    let mut buf = vec![0u8; len as usize];
    file.read_exact(&mut buf)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(buf)
}

async fn read_chunk_async(path: PathBuf, offset: u64, len: u64) -> Result<Vec<u8>, String> {
    tokio::task::spawn_blocking(move || read_chunk(&path, offset, len))
        .await
        .map_err(|e| e.to_string())?
}

fn upload_headers(key: &str, props: &ObjectProperties) -> Vec<(String, String)> {
    let mut props = props.clone();
    if props
        .content_type
        .as_deref()
        .is_none_or(|c| c.trim().is_empty())
    {
        props.content_type = Some(guess_content_type(key).to_string());
    }
    props.headers()
}

#[allow(clippy::too_many_arguments)]
async fn upload_multipart(
    s3: &S3,
    bucket: &str,
    key: &str,
    path: &Path,
    size: u64,
    headers: &[(String, String)],
    tracker: &Tracker,
    token: &CancellationToken,
) -> Result<(), String> {
    let mut create = Request::new(Method::POST, Some(bucket), Some(key)).query("uploads", "");
    for (name, value) in headers {
        create = create.header(name, value.clone());
    }
    let root = s3.xml(create).await?;
    let upload_id = root
        .text_of("UploadId")
        .ok_or("Multipart-Upload konnte nicht gestartet werden.")?;
    let part_size = PART_SIZE.max(size.div_ceil(10_000).next_multiple_of(1024 * 1024));
    let parts = size.div_ceil(part_size);
    let work = async {
        let jobs: Vec<_> = (0..parts)
            .map(|index| {
                let upload_id = upload_id.clone();
                let path = path.to_path_buf();
                async move {
                    let offset = index * part_size;
                    let len = part_size.min(size - offset);
                    let chunk = read_chunk_async(path, offset, len).await?;
                    let response = s3
                        .send(
                            Request::new(Method::PUT, Some(bucket), Some(key))
                                .query("partNumber", (index + 1).to_string())
                                .query("uploadId", upload_id)
                                .body(chunk)
                                .no_timeout(),
                        )
                        .await?;
                    let etag = response
                        .headers()
                        .get("etag")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or_default()
                        .to_string();
                    tracker.add(len);
                    Ok::<_, String>((index + 1, etag))
                }
            })
            .collect();
        let mut etags: Vec<(u64, String)> = stream::iter(jobs)
            .buffer_unordered(PART_CONCURRENCY)
            .try_collect()
            .await?;
        etags.sort();
        let body: String = etags
            .iter()
            .map(|(n, etag)| {
                format!(
                    "<Part><PartNumber>{n}</PartNumber><ETag>{}</ETag></Part>",
                    xml::escape(etag)
                )
            })
            .collect();
        let text = s3
            .text(
                Request::new(Method::POST, Some(bucket), Some(key))
                    .query("uploadId", upload_id.clone())
                    .xml(
                        format!("<CompleteMultipartUpload xmlns=\"{}\">{body}</CompleteMultipartUpload>", super::ops::S3_XMLNS),
                        "application/xml",
                    )
                    .no_timeout(),
            )
            .await?;
        match xml::parse(&text) {
            Ok(root) if root.name == "Error" => Err(format!(
                "S3 {}: {}",
                root.text_of("Code").unwrap_or_default(),
                root.text_of("Message").unwrap_or_default()
            )),
            _ => Ok(()),
        }
    };
    let result = tokio::select! {
        r = work => r,
        _ = token.cancelled() => Err(CANCELLED.to_string()),
    };
    if result.is_err() {
        let _ = s3.abort_multipart(bucket, key, &upload_id).await;
    }
    result
}

#[allow(clippy::too_many_arguments)]
async fn upload_file(
    s3: &S3,
    bucket: &str,
    key: &str,
    path: &Path,
    size: u64,
    props: &ObjectProperties,
    tracker: &Tracker,
    token: &CancellationToken,
) -> Result<(), String> {
    if token.is_cancelled() {
        return Err(CANCELLED.to_string());
    }
    tracker.start(key);
    let headers = upload_headers(key, props);
    if size > PART_SIZE {
        return upload_multipart(s3, bucket, key, path, size, &headers, tracker, token).await;
    }
    let body = read_chunk_async(path.to_path_buf(), 0, size).await?;
    tokio::select! {
        r = s3.put_bytes(bucket, key, body, &headers) => r.map(|_| ())?,
        _ = token.cancelled() => return Err(CANCELLED.to_string()),
    }
    tracker.add(size);
    Ok(())
}

pub async fn upload(
    s3: &S3,
    bucket: &str,
    prefix: &str,
    paths: &[String],
    props: &ObjectProperties,
    id: &str,
    emit: Emit,
) -> Result<TransferSummary, String> {
    let prefix = match prefix.trim_start_matches('/') {
        "" => String::new(),
        p if p.ends_with('/') => p.to_string(),
        p => format!("{p}/"),
    };
    let paths_owned: Vec<PathBuf> = paths.iter().map(PathBuf::from).collect();
    let base = prefix.clone();
    let files = tokio::task::spawn_blocking(move || {
        let mut out = Vec::new();
        for path in &paths_owned {
            collect(path, &base, &mut out)?;
        }
        Ok::<_, String>(out)
    })
    .await
    .map_err(|e| e.to_string())??;
    let (_registration, token) = register(id);
    let tracker = Tracker {
        id: id.to_string(),
        direction: "upload",
        bytes_total: AtomicU64::new(files.iter().map(|(_, _, s)| s).sum()),
        files_total: files.len(),
        bytes_done: AtomicU64::new(0),
        files_done: AtomicUsize::new(0),
        current: Mutex::new(None),
        last_emit: Mutex::new(Instant::now() - Duration::from_secs(1)),
        emit,
    };
    let jobs: Vec<_> = files
        .iter()
        .map(|(path, key, size)| {
            let tracker = &tracker;
            let token = &token;
            async move {
                let result = upload_file(s3, bucket, key, path, *size, props, tracker, token)
                    .await
                    .map_err(|e| format!("{key}: {e}"));
                if result.is_ok() {
                    tracker.file_done();
                }
                result
            }
        })
        .collect();
    let results: Vec<Result<(), String>> = stream::iter(jobs)
        .buffer_unordered(FILE_CONCURRENCY)
        .collect()
        .await;
    let summary = summarize(&tracker, results, token.is_cancelled());
    tracker.finish(&summary);
    Ok(summary)
}

fn summarize(
    tracker: &Tracker,
    results: Vec<Result<(), String>>,
    cancelled: bool,
) -> TransferSummary {
    TransferSummary {
        files: tracker.files_done.load(Ordering::Relaxed),
        bytes: tracker.bytes_done.load(Ordering::Relaxed),
        errors: results
            .into_iter()
            .filter_map(Result::err)
            .filter(|e| !e.ends_with(CANCELLED))
            .collect(),
        cancelled,
    }
}

async fn download_file(
    s3: &S3,
    bucket: &str,
    key: &str,
    version_id: Option<&str>,
    dest: &Path,
    tracker: &Tracker,
    token: &CancellationToken,
) -> Result<(), String> {
    tracker.start(key);
    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent)
            .await
            .map_err(|e| format!("{}: {e}", parent.display()))?;
    }
    let temp = dest.with_file_name(format!(
        ".{}.l8db-part",
        dest.file_name()
            .map(|n| n.to_string_lossy())
            .unwrap_or_default()
    ));
    let work = async {
        let mut response = s3
            .send(
                Request::new(Method::GET, Some(bucket), Some(key))
                    .query_opt("versionId", version_id)
                    .no_timeout(),
            )
            .await?;
        let mut file = tokio::fs::File::create(&temp)
            .await
            .map_err(|e| format!("{}: {e}", temp.display()))?;
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|e| format!("Download unterbrochen: {e}"))?
        {
            file.write_all(&chunk)
                .await
                .map_err(|e| format!("{}: {e}", temp.display()))?;
            tracker.add(chunk.len() as u64);
        }
        file.flush().await.map_err(|e| e.to_string())?;
        drop(file);
        tokio::fs::rename(&temp, dest)
            .await
            .map_err(|e| format!("{}: {e}", dest.display()))
    };
    let result = tokio::select! {
        r = work => r,
        _ = token.cancelled() => Err(CANCELLED.to_string()),
    };
    if result.is_err() {
        let _ = tokio::fs::remove_file(&temp).await;
    }
    result
}

pub async fn download(
    s3: &S3,
    bucket: &str,
    items: &[TransferItem],
    target: &str,
    id: &str,
    emit: Emit,
) -> Result<TransferSummary, String> {
    let target = PathBuf::from(target);
    let single_file = items.len() == 1 && !items[0].is_prefix && !target.is_dir();
    let mut plan: Vec<(String, Option<String>, u64, PathBuf)> = Vec::new();
    for item in items {
        if item.is_prefix {
            let base = parent_prefix(&item.key);
            for object in s3.keys_under(bucket, &item.key).await? {
                let relative = &object.key[base.len()..];
                let path = safe_join(&target, relative)?;
                if object.key.ends_with('/') {
                    tokio::fs::create_dir_all(&path)
                        .await
                        .map_err(|e| e.to_string())?;
                    continue;
                }
                plan.push((object.key.clone(), None, object.size, path));
            }
        } else {
            let head = s3
                .head_object(bucket, &item.key, item.version_id.as_deref())
                .await?;
            let path = if single_file {
                target.clone()
            } else {
                safe_join(&target, &item.key[parent_prefix(&item.key).len()..])?
            };
            plan.push((item.key.clone(), item.version_id.clone(), head.size, path));
        }
    }
    let (_registration, token) = register(id);
    let tracker = Tracker {
        id: id.to_string(),
        direction: "download",
        bytes_total: AtomicU64::new(plan.iter().map(|(_, _, s, _)| s).sum()),
        files_total: plan.len(),
        bytes_done: AtomicU64::new(0),
        files_done: AtomicUsize::new(0),
        current: Mutex::new(None),
        last_emit: Mutex::new(Instant::now() - Duration::from_secs(1)),
        emit,
    };
    let jobs: Vec<_> = plan
        .iter()
        .map(|(key, version, _, path)| {
            let tracker = &tracker;
            let token = &token;
            async move {
                let result =
                    download_file(s3, bucket, key, version.as_deref(), path, tracker, token)
                        .await
                        .map_err(|e| format!("{key}: {e}"));
                if result.is_ok() {
                    tracker.file_done();
                }
                result
            }
        })
        .collect();
    let results: Vec<Result<(), String>> = stream::iter(jobs)
        .buffer_unordered(FILE_CONCURRENCY)
        .collect()
        .await;
    let summary = summarize(&tracker, results, token.is_cancelled());
    tracker.finish(&summary);
    Ok(summary)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn safe_join_blocks_traversal() {
        let base = Path::new("/tmp/out");
        assert_eq!(
            safe_join(base, "a/b.txt").unwrap(),
            base.join("a").join("b.txt")
        );
        assert_eq!(
            safe_join(base, "/a//./c").unwrap(),
            base.join("a").join("c")
        );
        assert!(safe_join(base, "../etc/passwd").is_err());
        assert!(safe_join(base, "a/../../x").is_err());
        assert!(safe_join(base, "//").is_err());
        assert_eq!(safe_join(base, "a:b?.txt").unwrap(), base.join("a_b_.txt"));
    }

    #[test]
    fn guesses_content_types() {
        assert_eq!(guess_content_type("x/Y.JSON"), "application/json");
        assert_eq!(guess_content_type("data.csv"), "text/csv");
        assert_eq!(guess_content_type("blob"), "application/octet-stream");
    }
}
