use std::net::IpAddr;
use std::time::Duration;

use base64::Engine;
use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;

const PROXY_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_HTTP_RESPONSE: usize = 16 * 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProxyKind {
    Socks5,
    Http,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProxyRequest {
    pub kind: ProxyKind,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
}

impl ProxyRequest {
    pub fn label(&self) -> String {
        let kind = match self.kind {
            ProxyKind::Socks5 => "SOCKS5-Proxy",
            ProxyKind::Http => "HTTP-Proxy",
        };
        format!("{kind} {}:{}", self.host, self.port)
    }

    fn credentials(&self) -> Option<(&str, &str)> {
        let user = self.username.as_deref().filter(|value| !value.is_empty())?;
        Some((user, self.password.as_deref().unwrap_or("")))
    }
}

pub async fn connect(proxy: &ProxyRequest, host: &str, port: u16) -> Result<TcpStream, String> {
    if proxy.host.trim().is_empty() || proxy.port == 0 {
        return Err("Proxy-Host und -Port sind erforderlich.".to_string());
    }
    let label = proxy.label();
    tokio::time::timeout(PROXY_TIMEOUT, async {
        let mut stream = TcpStream::connect((proxy.host.as_str(), proxy.port))
            .await
            .map_err(|e| format!("{label} ist nicht erreichbar: {e}"))?;
        handshake(&mut stream, proxy, host, port)
            .await
            .map_err(|e| format!("{label}: {e}"))?;
        Ok(stream)
    })
    .await
    .map_err(|_| format!("{label} hat nicht innerhalb von 15 Sekunden geantwortet."))?
}

pub async fn handshake<S: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut S,
    proxy: &ProxyRequest,
    host: &str,
    port: u16,
) -> Result<(), String> {
    match proxy.kind {
        ProxyKind::Socks5 => socks5(stream, proxy.credentials(), host, port).await,
        ProxyKind::Http => http_connect(stream, proxy.credentials(), host, port).await,
    }
}

fn io_error(error: std::io::Error) -> String {
    format!("Verbindung zum Proxy abgebrochen: {error}")
}

async fn socks5<S: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut S,
    credentials: Option<(&str, &str)>,
    host: &str,
    port: u16,
) -> Result<(), String> {
    let greeting: &[u8] = if credentials.is_some() {
        &[5, 2, 0, 2]
    } else {
        &[5, 1, 0]
    };
    stream.write_all(greeting).await.map_err(io_error)?;
    let mut choice = [0u8; 2];
    stream.read_exact(&mut choice).await.map_err(io_error)?;
    if choice[0] != 5 {
        return Err("Antwort ist kein SOCKS5-Protokoll.".to_string());
    }
    match (choice[1], credentials) {
        (0, _) => {}
        (2, Some((user, password))) => {
            if user.len() > 255 || password.len() > 255 {
                return Err(
                    "SOCKS5-Benutzername und -Passwort dürfen höchstens 255 Bytes lang sein."
                        .to_string(),
                );
            }
            let mut auth = vec![1, user.len() as u8];
            auth.extend_from_slice(user.as_bytes());
            auth.push(password.len() as u8);
            auth.extend_from_slice(password.as_bytes());
            stream.write_all(&auth).await.map_err(io_error)?;
            let mut status = [0u8; 2];
            stream.read_exact(&mut status).await.map_err(io_error)?;
            if status[1] != 0 {
                return Err("Anmeldung abgelehnt (Benutzer oder Passwort prüfen).".to_string());
            }
        }
        (2, None) => {
            return Err("Proxy verlangt Benutzername und Passwort.".to_string());
        }
        _ => {
            return Err("Proxy akzeptiert keines der angebotenen Anmeldeverfahren.".to_string());
        }
    }
    let mut request = vec![5, 1, 0];
    match host.trim_matches(['[', ']']).parse::<IpAddr>() {
        Ok(IpAddr::V4(ip)) => {
            request.push(1);
            request.extend_from_slice(&ip.octets());
        }
        Ok(IpAddr::V6(ip)) => {
            request.push(4);
            request.extend_from_slice(&ip.octets());
        }
        Err(_) => {
            if host.is_empty() || host.len() > 255 {
                return Err(format!("Zielhost „{host}“ ist für SOCKS5 ungültig."));
            }
            request.push(3);
            request.push(host.len() as u8);
            request.extend_from_slice(host.as_bytes());
        }
    }
    request.extend_from_slice(&port.to_be_bytes());
    stream.write_all(&request).await.map_err(io_error)?;
    let mut reply = [0u8; 4];
    stream.read_exact(&mut reply).await.map_err(io_error)?;
    if reply[1] != 0 {
        return Err(format!(
            "Verbindung zu {host}:{port} abgelehnt ({}).",
            socks5_reply(reply[1])
        ));
    }
    let skip = match reply[3] {
        1 => 4,
        4 => 16,
        3 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await.map_err(io_error)?;
            len[0] as usize
        }
        _ => return Err("Ungültige SOCKS5-Antwort.".to_string()),
    };
    let mut rest = vec![0u8; skip + 2];
    stream.read_exact(&mut rest).await.map_err(io_error)?;
    Ok(())
}

fn socks5_reply(code: u8) -> &'static str {
    match code {
        1 => "allgemeiner Fehler",
        2 => "durch Regelwerk verboten",
        3 => "Netz nicht erreichbar",
        4 => "Host nicht erreichbar",
        5 => "Verbindung verweigert",
        6 => "TTL abgelaufen",
        7 => "Befehl nicht unterstützt",
        8 => "Adresstyp nicht unterstützt",
        _ => "unbekannter Fehler",
    }
}

fn authority(host: &str, port: u16) -> String {
    if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]:{port}")
    } else {
        format!("{host}:{port}")
    }
}

async fn http_connect<S: AsyncRead + AsyncWrite + Unpin>(
    stream: &mut S,
    credentials: Option<(&str, &str)>,
    host: &str,
    port: u16,
) -> Result<(), String> {
    let target = authority(host, port);
    let mut request = format!("CONNECT {target} HTTP/1.1\r\nHost: {target}\r\n");
    if let Some((user, password)) = credentials {
        let token = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"));
        request.push_str(&format!("Proxy-Authorization: Basic {token}\r\n"));
    }
    request.push_str("\r\n");
    stream
        .write_all(request.as_bytes())
        .await
        .map_err(io_error)?;
    let mut response = Vec::new();
    let mut byte = [0u8; 1];
    while !response.ends_with(b"\r\n\r\n") {
        if response.len() >= MAX_HTTP_RESPONSE {
            return Err("Antwort des HTTP-Proxys ist zu groß.".to_string());
        }
        let read = stream.read(&mut byte).await.map_err(io_error)?;
        if read == 0 {
            return Err("HTTP-Proxy hat die Verbindung ohne Antwort geschlossen.".to_string());
        }
        response.push(byte[0]);
    }
    let text = String::from_utf8_lossy(&response);
    let status_line = text.lines().next().unwrap_or_default().trim();
    let status = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|code| code.parse::<u16>().ok())
        .ok_or_else(|| format!("Ungültige Antwort des HTTP-Proxys: {status_line}"))?;
    if !(200..300).contains(&status) {
        let hint = if status == 407 {
            " Benutzer und Passwort des Proxys prüfen."
        } else {
            ""
        };
        return Err(format!(
            "CONNECT zu {target} abgelehnt: {status_line}.{hint}"
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{handshake, ProxyKind, ProxyRequest};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    fn proxy(kind: ProxyKind, user: Option<&str>) -> ProxyRequest {
        ProxyRequest {
            kind,
            host: "proxy".to_string(),
            port: 1080,
            username: user.map(str::to_string),
            password: user.map(|_| "geheim".to_string()),
        }
    }

    #[tokio::test]
    async fn socks5_with_credentials_sends_domain_request() {
        let (mut client, mut server) = tokio::io::duplex(1024);
        let server_task = tokio::spawn(async move {
            let mut greeting = [0u8; 4];
            server.read_exact(&mut greeting).await.unwrap();
            assert_eq!(greeting, [5, 2, 0, 2]);
            server.write_all(&[5, 2]).await.unwrap();
            let mut auth = [0u8; 2 + 5 + 1 + 6];
            server.read_exact(&mut auth).await.unwrap();
            assert_eq!(&auth[2..7], b"alice");
            assert_eq!(&auth[8..], b"geheim");
            server.write_all(&[1, 0]).await.unwrap();
            let mut head = [0u8; 5];
            server.read_exact(&mut head).await.unwrap();
            assert_eq!(&head[..4], &[5, 1, 0, 3]);
            let mut rest = vec![0u8; head[4] as usize + 2];
            server.read_exact(&mut rest).await.unwrap();
            assert_eq!(&rest[..head[4] as usize], b"db.internal");
            assert_eq!(&rest[head[4] as usize..], &5432u16.to_be_bytes());
            server
                .write_all(&[5, 0, 0, 1, 10, 0, 0, 1, 0x15, 0x38])
                .await
                .unwrap();
            server.write_all(b"payload").await.unwrap();
        });
        handshake(
            &mut client,
            &proxy(ProxyKind::Socks5, Some("alice")),
            "db.internal",
            5432,
        )
        .await
        .expect("handshake");
        let mut payload = [0u8; 7];
        client.read_exact(&mut payload).await.unwrap();
        assert_eq!(&payload, b"payload");
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn socks5_reports_refused_target() {
        let (mut client, mut server) = tokio::io::duplex(1024);
        tokio::spawn(async move {
            let mut greeting = [0u8; 3];
            server.read_exact(&mut greeting).await.unwrap();
            server.write_all(&[5, 0]).await.unwrap();
            let mut request = [0u8; 10];
            server.read_exact(&mut request).await.unwrap();
            assert_eq!(request[3], 1);
            server
                .write_all(&[5, 5, 0, 1, 0, 0, 0, 0, 0, 0])
                .await
                .unwrap();
        });
        let err = handshake(
            &mut client,
            &proxy(ProxyKind::Socks5, None),
            "10.0.0.5",
            5432,
        )
        .await
        .expect_err("must fail");
        assert!(err.contains("Verbindung verweigert"), "{err}");
    }

    #[tokio::test]
    async fn socks5_requires_credentials_when_demanded() {
        let (mut client, mut server) = tokio::io::duplex(1024);
        tokio::spawn(async move {
            let mut greeting = [0u8; 3];
            server.read_exact(&mut greeting).await.unwrap();
            server.write_all(&[5, 0xff]).await.unwrap();
        });
        let err = handshake(&mut client, &proxy(ProxyKind::Socks5, None), "db", 1)
            .await
            .expect_err("must fail");
        assert!(err.contains("Anmeldeverfahren"), "{err}");
    }

    #[tokio::test]
    async fn http_connect_sends_basic_auth_and_accepts_200() {
        let (mut client, mut server) = tokio::io::duplex(4096);
        let server_task = tokio::spawn(async move {
            let mut buf = Vec::new();
            let mut byte = [0u8; 1];
            while !buf.ends_with(b"\r\n\r\n") {
                server.read_exact(&mut byte).await.unwrap();
                buf.push(byte[0]);
            }
            let text = String::from_utf8(buf).unwrap();
            assert!(
                text.starts_with("CONNECT [::1]:5432 HTTP/1.1\r\n"),
                "{text}"
            );
            assert!(text.contains("Proxy-Authorization: Basic YWxpY2U6Z2VoZWlt\r\n"));
            server
                .write_all(b"HTTP/1.1 200 Connection established\r\n\r\nhello")
                .await
                .unwrap();
        });
        handshake(
            &mut client,
            &proxy(ProxyKind::Http, Some("alice")),
            "::1",
            5432,
        )
        .await
        .expect("handshake");
        let mut payload = [0u8; 5];
        client.read_exact(&mut payload).await.unwrap();
        assert_eq!(&payload, b"hello");
        server_task.await.unwrap();
    }

    #[tokio::test]
    async fn http_connect_rejects_proxy_auth_required() {
        let (mut client, mut server) = tokio::io::duplex(4096);
        tokio::spawn(async move {
            let mut buf = [0u8; 256];
            let _ = server.read(&mut buf).await.unwrap();
            server
                .write_all(
                    b"HTTP/1.1 407 Proxy Authentication Required\r\nContent-Length: 0\r\n\r\n",
                )
                .await
                .unwrap();
        });
        let err = handshake(&mut client, &proxy(ProxyKind::Http, None), "db", 5432)
            .await
            .expect_err("must fail");
        assert!(err.contains("407"), "{err}");
    }
}
