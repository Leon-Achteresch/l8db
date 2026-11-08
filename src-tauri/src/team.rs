use serde_json::{json, Value};
use std::io::Read;
use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 4 * 1024 * 1024;
const MAX_TIPS: usize = 20;
const TIP_FIELDS: [(&str, usize); 5] = [
    ("id", 64),
    ("title", 80),
    ("body", 600),
    ("featureId", 80),
    ("until", 40),
];

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
    let missing = || json!({ "path": shown, "exists": false, "connections": [], "tips": [] });
    let size = match std::fs::metadata(path) {
        Ok(meta) => meta.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(missing()),
        Err(error) => return Err(format!("{shown}: {error}")),
    };
    if size > MAX_BYTES {
        return Err(format!("{shown}: Datei ist größer als 4 MB"));
    }
    let mut bytes = Vec::new();
    std::fs::File::open(path)
        .and_then(|file| file.take(MAX_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|e| format!("{shown}: {e}"))?;
    if bytes.len() as u64 > MAX_BYTES {
        return Err(format!("{shown}: Datei ist größer als 4 MB"));
    }
    let utf16 = |data: &[u8], decode: fn([u8; 2]) -> u16| {
        String::from_utf16(
            &data
                .chunks_exact(2)
                .map(|pair| decode([pair[0], pair[1]]))
                .collect::<Vec<_>>(),
        )
        .map_err(|_| format!("{shown}: ungültiges UTF-16"))
    };
    let raw = if let Some(data) = bytes.strip_prefix(&[0xff, 0xfe]) {
        utf16(data, u16::from_le_bytes)?
    } else if let Some(data) = bytes.strip_prefix(&[0xfe, 0xff]) {
        utf16(data, u16::from_be_bytes)?
    } else {
        String::from_utf8(bytes).map_err(|_| format!("{shown}: kein gültiges UTF-8"))?
    };
    let mut tips = Vec::new();
    let connections = match serde_json::from_str::<Value>(raw.trim_start_matches('\u{feff}'))
        .map_err(|e| format!("{shown}: kein gültiges JSON ({e})"))?
    {
        Value::Array(list) => list,
        Value::Object(mut map) => {
            tips = team_tips(map.remove("tips"));
            match map.remove("connections") {
                Some(Value::Array(list)) => list,
                _ => return Err(format!("{shown}: \"connections\" muss eine Liste sein")),
            }
        }
        _ => {
            return Err(format!(
                "{shown}: erwartet eine Liste oder {{ \"connections\": [...] }}"
            ))
        }
    };
    Ok(json!({ "path": shown, "exists": true, "connections": connections, "tips": tips }))
}

fn team_tips(value: Option<Value>) -> Vec<Value> {
    let Some(Value::Array(list)) = value else {
        return Vec::new();
    };
    list.into_iter()
        .filter_map(|tip| {
            let tip = tip.as_object()?;
            let mut clean = serde_json::Map::new();
            for (key, max) in TIP_FIELDS {
                if let Some(text) = tip.get(key).and_then(Value::as_str) {
                    let text: String = text.trim().chars().take(max).collect();
                    if !text.is_empty() {
                        clean.insert(key.into(), Value::String(text));
                    }
                }
            }
            ["id", "title", "body"]
                .iter()
                .all(|key| clean.contains_key(*key))
                .then_some(Value::Object(clean))
        })
        .take(MAX_TIPS)
        .collect()
}

#[tauri::command(async)]
pub fn team_connections() -> Result<Value, String> {
    let path = team_file().ok_or("Benutzerordner konnte nicht ermittelt werden.")?;
    let organization = crate::organization::current(true)?;
    combine(read_team_file(&path), organization.as_ref())
}

fn combine(
    user: Result<Value, String>,
    organization: &crate::organization::Status,
) -> Result<Value, String> {
    let mut file = match user {
        Ok(file) => file,
        Err(error) if !organization.policy.connections.is_empty() => {
            json!({"path": organization.path, "exists": true, "connections": [], "warnings": [error]})
        }
        Err(error) => return Err(error),
    };
    if !organization.policy.connections.is_empty() {
        if file["exists"] == false {
            file["path"] = json!(organization.path);
        }
        file["exists"] = json!(true);
        file["connections"]
            .as_array_mut()
            .ok_or("Team-Datei ungültig")?
            .splice(0..0, organization.policy.connections.iter().cloned());
    }
    file["organization"] = serde_json::to_value(organization).map_err(|e| e.to_string())?;
    Ok(file)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn organization_connections_come_first_so_they_win_duplicate_ids() {
        let status = crate::organization::Status {
            path: "policy.json".into(),
            managed: true,
            policy: crate::organization::Policy {
                connections: vec![json!({"id":"shared","name":"Policy"})],
                ..Default::default()
            },
        };
        let user =
            json!({"path":"c.json","exists":true,"connections":[{"id":"shared","name":"Eigene"}]});
        let file = combine(Ok(user), &status).unwrap();
        assert_eq!(file["connections"][0]["name"], "Policy");
        assert_eq!(file["connections"][1]["name"], "Eigene");
    }

    #[test]
    fn protected_connections_survive_an_invalid_personal_team_file() {
        let status = crate::organization::Status {
            path: "policy.json".into(),
            managed: true,
            policy: crate::organization::Policy {
                connections: vec![json!({"id":"protected"})],
                ..Default::default()
            },
        };
        let file = combine(Err("Ungültige Benutzerdatei".into()), &status).unwrap();
        assert_eq!(file["connections"][0]["id"], "protected");
        assert_eq!(file["warnings"][0], "Ungültige Benutzerdatei");
        assert!(combine(
            Err("Ungültige Benutzerdatei".into()),
            &crate::organization::Status {
                policy: Default::default(),
                ..status
            }
        )
        .is_err());
    }

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
        std::fs::write(&file, r#"{"connections":[]}"#).unwrap();
        assert_eq!(read_team_file(&file).unwrap()["tips"], json!([]));
        let tips: Vec<Value> = (0..25)
            .map(|n| json!({"id": format!("t{n}"), "title": "T", "body": "x".repeat(900), "until": "2026-12-31"}))
            .chain([json!({"id": "leer", "title": "T"}), json!("kein objekt")])
            .collect();
        std::fs::write(
            &file,
            serde_json::to_string(&json!({"connections": [], "tips": tips})).unwrap(),
        )
        .unwrap();
        let parsed = read_team_file(&file).unwrap();
        let list = parsed["tips"].as_array().unwrap();
        assert_eq!(list.len(), 20);
        assert_eq!(list[0]["body"].as_str().unwrap().chars().count(), 600);
        assert_eq!(list[0]["until"], "2026-12-31");
        std::fs::write(&file, r#"{"connections":[],"tips":{"id":"x"}}"#).unwrap();
        assert_eq!(read_team_file(&file).unwrap()["tips"], json!([]));
        std::fs::remove_dir_all(&dir).unwrap();
        if let Some(path) = team_file() {
            assert!(path.ends_with(".l8db/connections.json"));
        }
    }

    #[test]
    fn windows_team_files_with_bom_crlf_and_utf16_keep_their_tips() {
        let dir = std::env::temp_dir().join(format!("l8db-team-tips-{}", rand::random::<u64>()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("connections.json");
        let text = "{\r\n  \"connections\": [ { \"id\": \"a\" } ],\r\n  \"tips\": [\r\n    { \"id\": \"t1\", \"title\": \"  Tipp  \", \"body\": \"Zeile 1\\r\\nZeile 2\", \"until\": \"2026-12-31\" },\r\n    { \"id\": \"t2\", \"title\": \"Ohne Text\", \"body\": \"   \" }\r\n  ]\r\n}\r\n";
        let check = |parsed: Value| {
            assert_eq!(parsed["exists"], true);
            assert_eq!(parsed["connections"][0]["id"], "a");
            let tips = parsed["tips"].as_array().unwrap();
            assert_eq!(tips.len(), 1);
            assert_eq!(tips[0]["title"], "Tipp");
            assert_eq!(tips[0]["body"], "Zeile 1\r\nZeile 2");
            assert_eq!(tips[0]["until"], "2026-12-31");
        };
        std::fs::write(&file, format!("\u{feff}{text}")).unwrap();
        check(read_team_file(&file).unwrap());
        let le: Vec<u8> = [0xff, 0xfe]
            .into_iter()
            .chain(text.encode_utf16().flat_map(u16::to_le_bytes))
            .collect();
        std::fs::write(&file, le).unwrap();
        check(read_team_file(&file).unwrap());
        let be: Vec<u8> = [0xfe, 0xff]
            .into_iter()
            .chain(text.encode_utf16().flat_map(u16::to_be_bytes))
            .collect();
        std::fs::write(&file, be).unwrap();
        check(read_team_file(&file).unwrap());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
