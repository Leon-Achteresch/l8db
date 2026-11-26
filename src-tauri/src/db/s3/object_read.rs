use base64::{engine::general_purpose::STANDARD, Engine};
use reqwest::{header, Method, Response, StatusCode};

use super::client::{Request, S3};
use super::ops::{ObjectPreview, MAX_PREVIEW_BYTES, MAX_TEXT_BYTES};

const INVALID_RANGE: &str = "Der Speicher hat einen ungültigen Objektbereich geliefert.";
const INCOMPLETE: &str = "Der Speicher hat das Objekt nur teilweise geliefert.";

struct Lengths {
    body: Option<u64>,
    object: Option<u64>,
}

impl Lengths {
    fn from_response(response: &Response) -> Result<Self, String> {
        let body = response.content_length();
        if response.status() == StatusCode::OK {
            return Ok(Self { body, object: body });
        }
        if response.status() != StatusCode::PARTIAL_CONTENT {
            return Err(format!(
                "Unerwartete Antwort beim Lesen des Objekts ({}).",
                response.status()
            ));
        }
        let value = response
            .headers()
            .get(header::CONTENT_RANGE)
            .and_then(|v| v.to_str().ok());
        let (unit, range) = value.and_then(|v| v.split_once(' ')).ok_or(INVALID_RANGE)?;
        let (span, total) = range.split_once('/').ok_or(INVALID_RANGE)?;
        let (start, end) = span.split_once('-').ok_or(INVALID_RANGE)?;
        let len = end
            .parse::<u64>()
            .ok()
            .and_then(|n| n.checked_add(1))
            .ok_or(INVALID_RANGE)?;
        let object = match total {
            "*" => None,
            _ => Some(total.parse::<u64>().map_err(|_| INVALID_RANGE)?),
        };
        if !unit.eq_ignore_ascii_case("bytes")
            || start.parse::<u64>() != Ok(0)
            || object.is_some_and(|n| n < len)
            || body.is_some_and(|n| n != len)
        {
            return Err(INVALID_RANGE.into());
        }
        Ok(Self {
            body: Some(len),
            object,
        })
    }
}

async fn read_prefix(
    mut response: Response,
    body: Option<u64>,
    limit: usize,
) -> Result<(Vec<u8>, bool), String> {
    let mut bytes = Vec::with_capacity(body.unwrap_or(0).min(limit as u64) as usize);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("Objekt konnte nicht gelesen werden: {e}"))?
    {
        if body.is_some_and(|n| bytes.len() as u64 + chunk.len() as u64 > n) {
            return Err(INVALID_RANGE.into());
        }
        let take = chunk.len().min(limit - bytes.len());
        let needed = bytes.len() + take;
        if needed > bytes.capacity() {
            let capacity = needed.max(bytes.capacity() * 2).min(limit);
            bytes.reserve_exact(capacity - bytes.len());
        }
        bytes.extend_from_slice(&chunk[..take]);
        if take < chunk.len() || (bytes.len() == limit && body.is_some_and(|n| n > limit as u64)) {
            return Ok((bytes, false));
        }
    }
    if body.is_some_and(|n| n != bytes.len() as u64) {
        return Err(INCOMPLETE.into());
    }
    Ok((bytes, true))
}

impl S3 {
    pub async fn preview(
        &self,
        bucket: &str,
        key: &str,
        version_id: Option<&str>,
        max_bytes: u64,
    ) -> Result<ObjectPreview, String> {
        let limit = max_bytes.clamp(1, MAX_PREVIEW_BYTES);
        let request = Request::new(Method::GET, Some(bucket), Some(key))
            .query_opt("versionId", version_id)
            .header("range", format!("bytes=0-{}", limit - 1));
        let response = match self.send(request).await {
            Ok(response) => response,
            Err(e) if e.status == 416 && e.code == "InvalidRange" => {
                return Ok(ObjectPreview {
                    content_type: None,
                    size: Some(0),
                    truncated: false,
                    data: String::new(),
                });
            }
            Err(e) => return Err(e.into()),
        };
        let partial = response.status() == StatusCode::PARTIAL_CONTENT;
        let lengths = Lengths::from_response(&response)?;
        let content_type = response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_owned);
        let (bytes, complete_body) = read_prefix(response, lengths.body, limit as usize).await?;
        let size = if complete_body && !partial {
            Some(bytes.len() as u64)
        } else {
            lengths.object
        };
        Ok(ObjectPreview {
            content_type,
            size,
            truncated: !complete_body || size != Some(bytes.len() as u64),
            data: STANDARD.encode(bytes),
        })
    }

    pub async fn get_text(&self, bucket: &str, key: &str) -> Result<String, String> {
        let response = self
            .send(Request::new(Method::GET, Some(bucket), Some(key)))
            .await?;
        let lengths = Lengths::from_response(&response)?;
        if let Some(size) = lengths.object.filter(|n| *n > MAX_TEXT_BYTES) {
            return Err(format!(
                "Objekt ist zu groß für den Editor ({size} Bytes, maximal {MAX_TEXT_BYTES})."
            ));
        }
        if response.status() == StatusCode::PARTIAL_CONTENT && lengths.body != lengths.object {
            return Err(INCOMPLETE.into());
        }
        let (bytes, complete) =
            read_prefix(response, lengths.body, MAX_TEXT_BYTES as usize).await?;
        if !complete {
            return Err(format!(
                "Objekt ist zu groß für den Editor (maximal {MAX_TEXT_BYTES} Bytes)."
            ));
        }
        String::from_utf8(bytes).map_err(|_| "Objekt ist kein UTF-8-Text.".to_string())
    }
}
