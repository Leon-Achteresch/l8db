use serde_json::{json, Value};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use super::config::{self, McpConfig, McpConnection};
use super::server::{arg_str, find_connection, with_database, Server};
use crate::db::{validate_table_filter_in, DatabaseKind};

const MAX_AGE_MS: u128 = 60_000;
const MAX_SPLIT: usize = 3;
const AUTO_REFRESH_SECONDS: [u64; 4] = [0, 5, 15, 30];

fn auto_refresh_arg() -> Value {
    json!({"type": "integer", "enum": AUTO_REFRESH_SECONDS, "description": "Auto-refresh seconds, 0 off; table only"})
}

pub fn tool_definition() -> Value {
    json!({
        "name": "open",
        "description": "Show in the user's l8db window: open a table, set or clear its filter, save it as a named view, turn on auto-refresh, open SQL in a new editor tab (not run), or show several tables/SQL side by side in a split view with master-detail links (selecting a master row filters its detail pane). Only when the user asks to see something in l8db; use query to answer questions.",
        "inputSchema": {"type": "object", "properties": {
            "connection": {"type": "string"},
            "database": super::server::database_arg(),
            "table": {"type": "string"},
            "filter": {"type": "string", "description": "WHERE condition; empty clears"},
            "saveAs": {"type": "string", "description": "View name, only when asked"},
            "sql": {"type": "string"},
            "autoRefresh": auto_refresh_arg(),
            "split": {"type": "array", "maxItems": MAX_SPLIT, "description": "Extra panes next to pane 1 (table or sql), numbered 2.. in order", "items": {"type": "object", "properties": {
                "table": {"type": "string"},
                "sql": {"type": "string"},
                "filter": {"type": "string"},
                "autoRefresh": auto_refresh_arg(),
                "master": {"type": "integer", "description": "Earlier pane number whose selected row drives this pane"},
                "link": {"type": "string", "description": "Read-only detail SELECT using :master.COLUMN; omit for table panes (foreign key) or sql panes that use :master.COLUMN"}
            }}},
            "orientation": {"type": "string", "enum": ["horizontal", "vertical"]}
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

fn auto_refresh(args: &Value) -> Result<Option<u64>, String> {
    match args.get("autoRefresh") {
        None | Some(Value::Null) => Ok(None),
        Some(value) => value
            .as_u64()
            .filter(|seconds| AUTO_REFRESH_SECONDS.contains(seconds))
            .map(Some)
            .ok_or_else(|| "autoRefresh muss 0, 5, 15 oder 30 sein.".into()),
    }
}

fn clean_filter(filter: &str, kind: DatabaseKind) -> Result<String, String> {
    let filter = filter.trim();
    let filter = filter
        .get(..6)
        .filter(|head| head.eq_ignore_ascii_case("where "))
        .map_or(filter, |_| filter[6..].trim());
    validate_table_filter_in(filter, kind != DatabaseKind::Postgres)?;
    Ok(filter.to_string())
}

fn check_link(link: &str) -> Result<(), String> {
    let head = link.trim_start().to_lowercase();
    let body = link.trim().trim_end_matches(';');
    if !(head.starts_with("select") || head.starts_with("with"))
        || body.contains(';')
        || !link.contains(":master.")
    {
        return Err("link muss ein einzelnes SELECT mit :master.SPALTE sein.".into());
    }
    Ok(())
}

impl Server {
    async fn open_pane(
        &mut self,
        config: &McpConfig,
        connection: &McpConnection,
        args: &Value,
    ) -> Result<(Value, String), String> {
        let sql = arg_str(args, "sql").trim();
        if !sql.is_empty() {
            if args.get("filter").is_some() || args.get("autoRefresh").is_some() {
                return Err("filter und autoRefresh gelten nur für Tabellen.".into());
            }
            return Ok((json!({"sql": sql}), "SQL-Tab (nicht ausgeführt)".into()));
        }
        let wanted = arg_str(args, "table").trim().to_lowercase();
        if wanted.is_empty() {
            return Err("table oder sql angeben.".into());
        }
        let scoped = with_database(connection, args)?;
        let catalog = self.catalog(config, &scoped).await?;
        let tables = catalog.tables();
        let found = tables
            .list
            .iter()
            .filter(|table| {
                tables.visible(table, scoped.allowed_schemas())
                    && (tables.name(table).to_lowercase() == wanted
                        || tables.qualified(table).to_lowercase() == wanted)
            })
            .min_by_key(|table| table.columns[0])
            .ok_or_else(|| format!("Tabelle '{wanted}' nicht gefunden. search nutzen."))?;
        let mut pane = json!({"schema": tables.schema(found), "table": tables.name(found)});
        let mut done = tables.qualified(found);
        if let Some(filter) = args.get("filter").and_then(Value::as_str) {
            let filter = clean_filter(filter, connection.kind)?;
            done += &if filter.is_empty() {
                ", Filter entfernt".to_string()
            } else {
                format!(", Filter: {filter}")
            };
            pane["filter"] = json!(filter);
        }
        if let Some(seconds) = auto_refresh(args)? {
            pane["autoRefresh"] = json!(seconds);
            done += &if seconds == 0 {
                ", Auto-Aktualisierung aus".to_string()
            } else {
                format!(", Auto-Aktualisierung alle {seconds} s")
            };
        }
        Ok((pane, done))
    }

    pub(super) async fn open(
        &mut self,
        config: &McpConfig,
        args: &Value,
    ) -> Result<String, String> {
        let connection = find_connection(config, arg_str(args, "connection"))?;
        let database = arg_str(args, "database").trim();
        let mut request = json!({
            "at": now_ms() as u64,
            "connectionId": connection.id,
            "database": (!database.is_empty()).then_some(database),
        });
        let split = match args.get("split") {
            None | Some(Value::Null) => Vec::new(),
            Some(Value::Array(list)) if list.len() <= MAX_SPLIT => list.clone(),
            Some(_) => {
                return Err(format!(
                    "split erlaubt höchstens {MAX_SPLIT} weitere Bereiche."
                ))
            }
        };
        if split.is_empty() && !arg_str(args, "sql").trim().is_empty() {
            request["sql"] = json!(arg_str(args, "sql").trim());
            push(request)?;
            return Ok(format!(
                "SQL wird in l8db ({}) in einem neuen Editor-Tab geöffnet, nicht ausgeführt.",
                connection.name
            ));
        }
        let (main, mut done) = self.open_pane(config, connection, args).await?;
        let main_is_table = main.get("table").is_some();
        for (key, value) in main.as_object().into_iter().flatten() {
            request[key] = value.clone();
        }
        done = format!("{done} wird in l8db ({}) geöffnet", connection.name);
        let save_as = arg_str(args, "saveAs").trim();
        if !save_as.is_empty() {
            if request["filter"].as_str().unwrap_or("").is_empty() {
                return Err("saveAs braucht einen filter.".into());
            }
            request["saveAs"] = json!(save_as);
            done += &format!(", gespeichert als Ansicht '{save_as}'");
        }
        if !split.is_empty() {
            let mut panes = Vec::new();
            let mut tables = vec![main_is_table];
            for (index, entry) in split.iter().enumerate() {
                let number = index + 2;
                let scoped = match entry {
                    Value::Object(_) => {
                        let mut merged = entry.clone();
                        merged["database"] = json!(database);
                        merged
                    }
                    _ => return Err(format!("Bereich {number}: Objekt erwartet.")),
                };
                let (mut pane, label) = self.open_pane(config, connection, &scoped).await?;
                let mut line = format!("\n{number}: {label}");
                if let Some(master) = entry.get("master").filter(|value| !value.is_null()) {
                    let master = master
                        .as_u64()
                        .filter(|master| *master >= 1 && (*master as usize) < number)
                        .ok_or_else(|| {
                            format!(
                                "Bereich {number}: master muss ein früherer Bereich (1–{}) sein.",
                                number - 1
                            )
                        })?;
                    let link = arg_str(entry, "link").trim();
                    let own = arg_str(entry, "sql").trim();
                    if link.is_empty() && own.contains(":master.") {
                        check_link(own).map_err(|error| format!("Bereich {number}: {error}"))?;
                        line += &format!(", Detail von {master}");
                    } else if link.is_empty() {
                        if !(tables[master as usize - 1] && pane.get("table").is_some()) {
                            return Err(format!(
                                "Bereich {number}: link mit :master.SPALTE angeben (Fremdschlüssel nur zwischen Tabellen)."
                            ));
                        }
                        line += &format!(", Detail von {master} über Fremdschlüssel");
                    } else {
                        check_link(link).map_err(|error| format!("Bereich {number}: {error}"))?;
                        pane["link"] = json!(link);
                        line += &format!(", Detail von {master}");
                    }
                    pane["master"] = json!(master - 1);
                } else if !arg_str(entry, "link").trim().is_empty() {
                    return Err(format!("Bereich {number}: link braucht master."));
                }
                tables.push(pane.get("table").is_some());
                panes.push(pane);
                done += &line;
            }
            request["split"] = json!(panes);
            if let Some(orientation) = args.get("orientation").and_then(Value::as_str) {
                if !matches!(orientation, "horizontal" | "vertical") {
                    return Err("orientation muss horizontal oder vertical sein.".into());
                }
                request["orientation"] = json!(orientation);
            }
            done = format!("Split-Ansicht: 1: {done}");
        }
        push(request)?;
        Ok(format!(
            "{done}\nLäuft l8db nicht, verfällt die Anfrage nach 60 s."
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_split_arguments() {
        assert_eq!(auto_refresh(&json!({})), Ok(None));
        assert_eq!(auto_refresh(&json!({"autoRefresh": 15})), Ok(Some(15)));
        assert!(auto_refresh(&json!({"autoRefresh": 7})).is_err());
        assert!(check_link("SELECT * FROM orders WHERE customer_id = :master.id").is_ok());
        assert!(check_link("delete from orders where id = :master.id").is_err());
        assert!(check_link("select 1; select :master.id").is_err());
        assert!(check_link("select * from orders").is_err());
        assert_eq!(
            clean_filter("WHERE id = 1", DatabaseKind::Postgres).unwrap(),
            "id = 1"
        );
        assert!(clean_filter("1=1; drop table x", DatabaseKind::Postgres).is_err());
    }

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
