use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::config::{self, McpConfig};
use super::server::{arg_str, find_connection, qualified, with_database, Server};
use crate::db::validate_table_filter;

const MAX_AGE_MS: u128 = 60_000;

pub fn tool_definition() -> Value {
    json!({
        "name": "open",
        "description": "Show something live in the l8db window the user is working in: open a table or view, set or clear its filter, save the filter as a named view, or open SQL in a new editor tab (not executed). The app highlights the change so the user sees the AI did it. Only call this when the user asks to open, show or filter something in l8db, or to save a filter, or the request clearly implies seeing it in the app. Never call it just to answer a question; use query for that. Call search first to get exact table names.",
        "inputSchema": {"type": "object", "properties": {
            "connection": {"type": "string"},
            "database": super::server::database_arg(),
            "table": {"type": "string", "description": "schema.table to open"},
            "filter": {"type": "string", "description": "SQL WHERE condition without the WHERE keyword, e.g. status = 'open' AND total > 100. Empty string clears the filter."},
            "saveAs": {"type": "string", "description": "Save the filter as a named view on the table. Only when the user asks to save it."},
            "sql": {"type": "string", "description": "Opens this SQL in a new editor tab instead of a table"}
        }, "required": ["connection"]}
    })
}

fn queue_path() -> PathBuf {
    config::config_path().with_file_name("mcp-open.jsonl")
}

fn now_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default()
}

fn push(request: Value) -> Result<(), String> {
    let path = queue_path();
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .map_err(|e| e.to_string())?;
    writeln!(file, "{request}").map_err(|e| e.to_string())
}

#[tauri::command]
pub fn mcp_take_open_requests() -> Vec<Value> {
    let path = queue_path();
    let taken = path.with_extension(format!("{}.take", std::process::id()));
    if fs::rename(&path, &taken).is_err() {
        return Vec::new();
    }
    let text = fs::read_to_string(&taken).unwrap_or_default();
    let _ = fs::remove_file(&taken);
    let fresh = now_ms().saturating_sub(MAX_AGE_MS);
    text.lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|request| request["at"].as_u64().is_some_and(|at| at as u128 >= fresh))
        .collect()
}

impl Server {
    pub(super) async fn open(
        &mut self,
        config: &McpConfig,
        args: &Value,
    ) -> Result<String, String> {
        let connection = find_connection(config, arg_str(args, "connection"))?;
        let database = arg_str(args, "database").trim();
        let sql = arg_str(args, "sql").trim();
        let mut request = json!({
            "at": now_ms() as u64,
            "connectionId": connection.id,
            "database": (!database.is_empty()).then_some(database),
        });
        if !sql.is_empty() {
            request["sql"] = json!(sql);
            push(request)?;
            return Ok(format!(
                "SQL wird in l8db ({}) in einem neuen Editor-Tab geöffnet, nicht ausgeführt.",
                connection.name
            ));
        }
        let wanted = arg_str(args, "table").trim().to_lowercase();
        if wanted.is_empty() {
            return Err("table oder sql angeben.".into());
        }
        let scoped = with_database(connection, args)?;
        let columns = self.columns_for(config, &scoped).await?;
        let found = Self::visible_columns(&columns, &scoped)
            .into_iter()
            .find(|column| {
                column.table.to_lowercase() == wanted
                    || qualified(&column.schema, &column.table).to_lowercase() == wanted
            })
            .ok_or_else(|| format!("Tabelle '{wanted}' nicht gefunden. search nutzen."))?;
        request["schema"] = json!(found.schema);
        request["table"] = json!(found.table);
        let mut done = format!(
            "{} wird in l8db ({}) geöffnet",
            qualified(&found.schema, &found.table),
            connection.name
        );
        if let Some(filter) = args.get("filter").and_then(Value::as_str) {
            let filter = filter.trim().trim_start_matches("WHERE ").trim();
            validate_table_filter(filter)?;
            request["filter"] = json!(filter);
            done += &if filter.is_empty() {
                ", Filter entfernt".to_string()
            } else {
                format!(", Filter: {filter}")
            };
        }
        let save_as = arg_str(args, "saveAs").trim();
        if !save_as.is_empty() {
            if request["filter"].as_str().unwrap_or("").is_empty() {
                return Err("saveAs braucht einen filter.".into());
            }
            request["saveAs"] = json!(save_as);
            done += &format!(", gespeichert als Ansicht '{save_as}'");
        }
        push(request)?;
        Ok(format!(
            "{done}. Läuft l8db nicht, verfällt die Anfrage nach 60 s."
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takes_only_fresh_requests_once() {
        let _guard = super::super::TEST_ENV_LOCK.lock().unwrap();
        let dir = std::env::temp_dir().join(format!("l8db-open-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        std::env::set_var("L8DB_MCP_CONFIG", dir.join("mcp.json"));
        push(json!({"at": now_ms() as u64, "table": "a"})).unwrap();
        push(json!({"at": 1, "table": "old"})).unwrap();
        let taken = mcp_take_open_requests();
        assert_eq!(taken.len(), 1);
        assert_eq!(taken[0]["table"], "a");
        assert!(mcp_take_open_requests().is_empty());
        std::env::remove_var("L8DB_MCP_CONFIG");
        let _ = fs::remove_dir_all(dir);
    }
}
