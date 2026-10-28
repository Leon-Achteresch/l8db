use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 4 * 1024 * 1024;

pub fn team_file() -> Option<PathBuf> {
    let base = if cfg!(windows) {
        std::env::var_os("APPDATA").map(PathBuf::from)
    } else {
        std::env::var_os("HOME").map(PathBuf::from)
    };
    base.filter(|dir| !dir.as_os_str().is_empty())
        .map(|dir| dir.join(".l8db").join("connections.json"))
}

fn read_team_file(path: &Path) -> Result<Value, String> {
    let shown = path.display().to_string();
    let missing = || json!({ "path": shown, "exists": false, "connections": [] });
    let size = match std::fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(missing()),
        Err(error) => return Err(format!("{shown}: {error}")),
    };
    if size > MAX_BYTES {
        return Err(format!("{shown}: Datei ist größer als 4 MB"));
    }
    let bytes = std::fs::read(path).map_err(|e| format!("{shown}: {e}"))?;
    let raw = match bytes.strip_prefix(&[0xff, 0xfe]) {
        Some(utf16) => String::from_utf16(
            &utf16
                .chunks_exact(2)
                .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
                .collect::<Vec<_>>(),
        )
        .map_err(|_| format!("{shown}: ungültiges UTF-16"))?,
        None => String::from_utf8(bytes).map_err(|_| format!("{shown}: kein gültiges UTF-8"))?,
    };
    let connections = match serde_json::from_str::<Value>(raw.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("{shown}: kein gültiges JSON ({e})"))?
    {
        Value::Array(list) => list,
        Value::Object(mut map) => match map.remove("connections") {
            Some(Value::Array(list)) => list,
            _ => return Err(format!("{shown}: \"connections\" muss eine Liste sein")),
        },
        _ => {
            return Err(format!(
                "{shown}: erwartet eine Liste oder {{ \"connections\": [...] }}"
            ))
        }
    };
    Ok(json!({ "path": shown, "exists": true, "connections": connections }))
}

#[tauri::command(async)]
pub fn team_connections() -> Result<Value, String> {
    let path = team_file().ok_or("Benutzerordner konnte nicht ermittelt werden.")?;
    read_team_file(&path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_team_file_is_read_as_list_or_object_and_rejects_garbage() {
        let dir = std::env::temp_dir().join(format!("l8db-team-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("connections.json");
        let missing = read_team_file(&file).unwrap();
        assert_eq!(missing["exists"], false);
        assert_eq!(missing["connections"], json!([]));
        std::fs::write(&file, "\u{feff}[{\"id\":\"a\"}]").unwrap();
        assert_eq!(read_team_file(&file).unwrap()["connections"][0]["id"], "a");
        std::fs::write(&file, r#"{"connections":[{"id":"b"}]}"#).unwrap();
        let object = read_team_file(&file).unwrap();
        assert_eq!(object["exists"], true);
        assert_eq!(object["connections"][0]["id"], "b");
        let utf16: Vec<u8> = [0xff, 0xfe]
            .into_iter()
            .chain("[{\"id\":\"c\"}]".encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        std::fs::write(&file, utf16).unwrap();
        assert_eq!(read_team_file(&file).unwrap()["connections"][0]["id"], "c");
        std::fs::write(&file, "kein json").unwrap();
        assert!(read_team_file(&file).unwrap_err().contains("JSON"));
        std::fs::write(&file, r#"{"connections":{}}"#).unwrap();
        assert!(read_team_file(&file).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
        if let Some(path) = team_file() {
            assert!(path.ends_with(".l8db/connections.json"));
        }
    }
}
