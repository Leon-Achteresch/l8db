use base64::Engine;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::time::Duration;
use tauri_plugin_dialog::DialogExt;
use tokio::io::AsyncWriteExt;

const MAX_PREVIEW_BYTES: usize = 4 * 1024 * 1024;

#[derive(Serialize)]
pub struct BaasFilePreview {
    pub mime_type: String,
    pub base64: String,
    pub size: usize,
}

pub fn download_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .read_timeout(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("BaaS download HTTP client")
    })
}

pub fn upload_client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(20))
            .read_timeout(Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .expect("BaaS upload HTTP client")
    })
}

pub async fn pick_save_path(app: tauri::AppHandle, name: &str) -> Result<Option<PathBuf>, String> {
    let filename = name
        .replace('\\', "/")
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty() && *value != "." && *value != "..")
        .unwrap_or("download")
        .to_string();
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .set_file_name(filename)
        .save_file(move |path| {
            let _ = sender.send(path);
        });
    let picked = receiver
        .await
        .map_err(|_| "Speicherdialog wurde unterbrochen.".to_string())?;
    picked
        .map(|path| {
            path.into_path()
                .map_err(|_| "Dateipfad konnte nicht gelesen werden.".to_string())
        })
        .transpose()
}

pub async fn pick_open_path(app: tauri::AppHandle) -> Result<Option<PathBuf>, String> {
    let (sender, receiver) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_file(move |path| {
        let _ = sender.send(path);
    });
    let picked = receiver
        .await
        .map_err(|_| "Dateidialog wurde unterbrochen.".to_string())?;
    picked
        .map(|path| {
            path.into_path()
                .map_err(|_| "Dateipfad konnte nicht gelesen werden.".to_string())
        })
        .transpose()
}

pub async fn save_response(mut response: reqwest::Response, path: PathBuf) -> Result<(), String> {
    if !response.status().is_success() {
        return Err(format!(
            "HTTP {}: Datei konnte nicht geladen werden.",
            response.status().as_u16()
        ));
    }
    let parent = path
        .parent()
        .ok_or_else(|| "Ungültiger Zielpfad.".to_string())?;
    let temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| "Temporäre Datei konnte nicht erstellt werden.".to_string())?;
    let file = temporary
        .reopen()
        .map_err(|_| "Temporäre Datei konnte nicht geöffnet werden.".to_string())?;
    let mut writer = tokio::fs::File::from_std(file);
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "Datei konnte nicht vollständig geladen werden.".to_string())?
    {
        writer
            .write_all(&chunk)
            .await
            .map_err(|_| "Datei konnte nicht geschrieben werden.".to_string())?;
    }
    writer
        .flush()
        .await
        .map_err(|_| "Datei konnte nicht abgeschlossen werden.".to_string())?;
    drop(writer);
    temporary
        .persist(path)
        .map_err(|_| "Datei konnte nicht gespeichert werden.".to_string())?;
    Ok(())
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
    use super::{preview_response, save_response};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[tokio::test]
    async fn preview_reads_content_without_exposing_headers() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = [0_u8; 2048];
            let _ = stream.read(&mut buffer).await.unwrap();
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
            let _ = stream.read(&mut buffer).await.unwrap();
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

    #[tokio::test]
    async fn download_streams_to_selected_path() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = [0_u8; 2048];
            let _ = stream.read(&mut buffer).await.unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello")
                .await
                .unwrap();
        });
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("download.txt");
        let response = reqwest::get(format!("http://{address}")).await.unwrap();
        save_response(response, path.clone()).await.unwrap();
        assert_eq!(std::fs::read(path).unwrap(), b"hello");
        server.await.unwrap();
    }

    #[tokio::test]
    async fn failed_download_preserves_existing_file() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = [0_u8; 2048];
            let _ = stream.read(&mut buffer).await.unwrap();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\n\r\nabc")
                .await
                .unwrap();
        });
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("download.txt");
        std::fs::write(&path, b"original").unwrap();
        let response = reqwest::get(format!("http://{address}")).await.unwrap();
        assert!(save_response(response, path.clone()).await.is_err());
        assert_eq!(std::fs::read(path).unwrap(), b"original");
        server.await.unwrap();
    }
}
