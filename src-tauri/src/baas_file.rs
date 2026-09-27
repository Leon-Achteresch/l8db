use base64::Engine;
use serde::Serialize;

const MAX_PREVIEW_BYTES: usize = 4 * 1024 * 1024;

#[derive(Serialize)]
pub struct BaasFilePreview {
    pub mime_type: String,
    pub base64: String,
    pub size: usize,
}

pub async fn preview_response(mut response: reqwest::Response) -> Result<BaasFilePreview, String> {
    let status = response.status();
    if !status.is_success() {
        let hint = match status.as_u16() {
            401 => "Zugangsdaten ungültig oder abgelaufen.",
            403 => "Für diese Datei fehlt die Berechtigung.",
            404 => "Datei nicht gefunden.",
            _ => "Datei konnte nicht geladen werden.",
        };
        return Err(format!("HTTP {}: {hint}", status.as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|size| size > MAX_PREVIEW_BYTES as u64)
    {
        return Err("Datei ist für die Vorschau zu groß (maximal 4 MB).".into());
    }
    let mime_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/octet-stream")
        .split(';')
        .next()
        .unwrap_or("application/octet-stream")
        .trim()
        .to_ascii_lowercase();
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Datei konnte nicht vollständig geladen werden.")?
    {
        if bytes.len() + chunk.len() > MAX_PREVIEW_BYTES {
            return Err("Datei ist für die Vorschau zu groß (maximal 4 MB).".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(BaasFilePreview {
        mime_type,
        base64: base64::engine::general_purpose::STANDARD.encode(&bytes),
        size: bytes.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::preview_response;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn preview_reads_content_without_exposing_headers() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = [0_u8; 2048];
            stream.read(&mut buffer).await.unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: 5\r\n\r\nhello")
                .await
                .unwrap();
        });
        let response = reqwest::get(format!("http://{address}")).await.unwrap();
        let preview = preview_response(response).await.unwrap();
        assert_eq!(preview.mime_type, "text/plain");
        assert_eq!(preview.base64, "aGVsbG8=");
        assert_eq!(preview.size, 5);
        server.await.unwrap();
    }

    #[tokio::test]
    async fn preview_rejects_oversized_file_before_reading_body() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = [0_u8; 2048];
            stream.read(&mut buffer).await.unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4194305\r\n\r\n")
                .await
                .unwrap();
        });
        let response = reqwest::get(format!("http://{address}")).await.unwrap();
        let error = preview_response(response).await.err().unwrap();
        assert!(error.contains("4 MB"));
        server.await.unwrap();
    }
}
