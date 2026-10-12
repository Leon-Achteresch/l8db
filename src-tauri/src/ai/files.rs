use super::{runtime::Run, types::Attachment};
use crate::db::{
    csv_stream::CsvFileSource, import_source::ImportFormat, ColumnDefinition, CreateTableRequest,
    CsvImportRequest, DatabaseKind,
};
use crate::mcp::{config::McpConfig, server::Server};
use serde_json::{json, Value};

const PREVIEW_ROWS: usize = 20;
const MAX_CELL: usize = 120;
const PREVIEW_COLUMNS: usize = 50;
const MAX_PROMPT: usize = 32_000;

pub fn prompt(attachments: &[Attachment]) -> String {
    let mut text = String::new();
    let file_budget = (MAX_PROMPT / attachments.len().max(1)).min(8_000);
    for file in attachments {
        let mut preview = format!(
            "\nAttached file \"{}\" ({:?}, {} rows, columns: {}). First rows as TSV:\n{}\n",
            file.name,
            file.format,
            file.total_rows
                .map(|rows| rows.to_string())
                .unwrap_or_else(|| "unknown".into()),
            file.columns
                .iter()
                .take(PREVIEW_COLUMNS)
                .enumerate()
                .map(|(index, column)| match file.types.get(index) {
                    Some(kind) if !kind.is_empty() => format!("{column} ({kind})"),
                    _ => column.clone(),
                })
                .collect::<Vec<_>>()
                .join(", "),
            file.rows
                .iter()
                .take(PREVIEW_ROWS)
                .map(|row| row
                    .iter()
                    .take(PREVIEW_COLUMNS)
                    .map(|cell| cell
                        .as_deref()
                        .unwrap_or("NULL")
                        .replace(['\t', '\n', '\r'], " ")
                        .chars()
                        .take(MAX_CELL)
                        .collect::<String>())
                    .collect::<Vec<_>>()
                    .join("\t"))
                .collect::<Vec<_>>()
                .join("\n")
        );
        if file.columns.len() > PREVIEW_COLUMNS {
            preview.push_str(&format!(
                "[{} further columns omitted from preview]\n",
                file.columns.len() - PREVIEW_COLUMNS
            ));
        }
        text.push_str(&crate::mcp::server::cap(preview, file_budget));
        text.push('\n');
    }
    if !text.is_empty() {
        text.push_str("To load an attached file into the database use the import_file tool; it always creates a new table and asks the user first.\n");
    }
    text
}

pub fn tool_definition() -> Value {
    json!({
        "name": "import_file",
        "description": "Create a new table from a file the user attached to the chat and load all its rows. Never touches existing tables. The user must approve.",
        "inputSchema": {"type": "object", "properties": {
            "file": {"type": "string", "description": "Name of the attached file"},
            "connection": {"type": "string"},
            "schema": {"type": "string"},
            "table": {"type": "string", "description": "Name of the new table"},
            "columns": {"type": "array", "description": "One entry per file column in file order. Omit to store every column as text.", "items": {"type": "object", "properties": {
                "name": {"type": "string"},
                "type": {"type": "string", "description": "Column type in the target database's SQL dialect"}
            }, "required": ["name", "type"]}}
        }, "required": ["file", "connection", "table"]}
    })
}

fn text_type(kind: DatabaseKind) -> &'static str {
    match kind {
        DatabaseKind::Mssql => "NVARCHAR(MAX)",
        DatabaseKind::Oracle => "VARCHAR2(4000)",
        DatabaseKind::Clickhouse => "Nullable(String)",
        _ => "TEXT",
    }
}

fn fallback_schema(kind: DatabaseKind, database: Option<&str>) -> String {
    match kind {
        DatabaseKind::Postgres => "public".into(),
        DatabaseKind::Mssql => "dbo".into(),
        DatabaseKind::Sqlite | DatabaseKind::Duckdb => "main".into(),
        _ => database.unwrap_or_default().into(),
    }
}

fn identifier(value: &str, label: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > 128 || value.chars().any(char::is_control) {
        return Err(format!("Ungültiger {label}"));
    }
    Ok(value.into())
}

pub fn columns(
    file: &Attachment,
    kind: DatabaseKind,
    args: &Value,
) -> Result<Vec<ColumnDefinition>, String> {
    let requested = args["columns"].as_array();
    if let Some(requested) = requested {
        if requested.len() != file.columns.len() {
            return Err(format!(
                "Die Datei hat {} Spalten, columns muss genauso viele Einträge haben.",
                file.columns.len()
            ));
        }
    }
    file.columns
        .iter()
        .enumerate()
        .map(|(index, column)| {
            let entry = requested.and_then(|list| list.get(index));
            let name = identifier(
                entry
                    .and_then(|entry| entry["name"].as_str())
                    .unwrap_or(column),
                "Spaltenname",
            )?;
            let data_type = entry
                .and_then(|entry| entry["type"].as_str())
                .map(str::trim)
                .filter(|kind| !kind.is_empty())
                .unwrap_or(text_type(kind));
            if data_type.len() > 64
                || !data_type
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || " (),_".contains(c))
            {
                return Err(format!("Ungültiger Spaltentyp {data_type}"));
            }
            Ok(ColumnDefinition {
                name,
                data_type: data_type.into(),
                is_nullable: true,
                default_value: None,
                is_primary_key: false,
                is_unique: false,
            })
        })
        .collect()
}

async fn import(
    server: &tokio::sync::Mutex<Server>,
    config: &McpConfig,
    run: &Run,
    args: &Value,
) -> Result<String, String> {
    if run.plan_only {
        return Err("Import ist im Plan-Modus gesperrt.".into());
    }
    let name = args["file"].as_str().unwrap_or("");
    let file = run
        .scope
        .attachments
        .iter()
        .find(|file| file.name == name)
        .ok_or("Diese Datei ist nicht an das Gespräch angehängt.")?;
    let target = args["connection"].as_str().unwrap_or("");
    let policy = config
        .connections
        .iter()
        .find(|connection| connection.id == target || connection.name.eq_ignore_ascii_case(target))
        .ok_or("Verbindung ist nicht im Gespräch ausgewählt.")?;
    let selected = run
        .scope
        .connections
        .iter()
        .find(|connection| connection.id == policy.id)
        .ok_or("Verbindung ist nicht im Gespräch ausgewählt.")?;
    if selected.read_only || policy.is_production() {
        return Err(format!(
            "Verbindung '{}' ist schreibgeschützt oder als Produktion markiert.",
            policy.name
        ));
    }
    if !policy.kind.capabilities().csv_import {
        return Err("Dateiimport wird für diesen Datenbanktyp nicht unterstützt.".into());
    }
    let table = identifier(args["table"].as_str().unwrap_or(""), "Tabellenname")?;
    let schema = match args["schema"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        Some(schema) => identifier(schema, "Schemaname")?,
        None => selected
            .default_schema
            .clone()
            .filter(|schema| !schema.is_empty())
            .or_else(|| policy.schemas.first().cloned())
            .unwrap_or_else(|| fallback_schema(policy.kind, policy.database.as_deref())),
    };
    let definitions = columns(file, policy.kind, args)?;
    let approved = run
        .approve(
            "Datei als neue Tabelle importieren",
            json!({
                "file": file.name,
                "connection": policy.name,
                "table": if schema.is_empty() { table.clone() } else { format!("{schema}.{table}") },
                "rows": file.total_rows,
                "columns": definitions.iter().map(|column| format!("{} {}", column.name, column.data_type)).collect::<Vec<_>>(),
            }),
        )
        .await?;
    if !approved {
        return Err("Benutzer hat den Import abgelehnt.".into());
    }
    let mut writable = policy.clone();
    writable.read_only = false;
    let pool = server.lock().await.pool.clone();
    let adapter = crate::mcp::server::adapter(&writable, &pool)?;
    adapter
        .create_table(&CreateTableRequest {
            schema: schema.clone(),
            name: table.clone(),
            columns: definitions.clone(),
            if_not_exists: false,
            primary_key_name: None,
            constraints: vec![],
        })
        .await?;
    let json_keys = matches!(file.format, ImportFormat::Json | ImportFormat::Ndjson);
    let request = CsvImportRequest {
        file: Some(CsvFileSource {
            path: file.path.clone(),
            delimiter: file.delimiter.clone(),
            quote: file.quote.clone(),
            has_header: file.has_header,
            empty_as_null: true,
            indices: (0..file.columns.len()).collect(),
            format: file.format,
            sheet: file.sheet.clone(),
            skip_rows: 0,
            keys: if json_keys {
                file.columns.clone()
            } else {
                vec![]
            },
        }),
        conflict: None,
        schema: schema.clone(),
        table: table.clone(),
        columns: definitions
            .iter()
            .map(|column| column.name.clone())
            .collect(),
        rows: vec![],
    };
    let url = crate::mcp::server::connection_url(&writable)?;
    let outcome = crate::db::commands::run_csv_import(
        policy.kind,
        &url,
        policy.database.as_deref(),
        pool,
        &request,
    )
    .await?;
    if let Some(error) = outcome.error {
        return Err(format!(
            "Tabelle {table} wurde angelegt, der Import brach aber ab: {error}"
        ));
    }
    Ok(format!(
        "ok, Tabelle {table} angelegt und {} Zeilen importiert",
        outcome.inserted_rows
    ))
}

pub async fn call(
    server: &tokio::sync::Mutex<Server>,
    config: &McpConfig,
    run: &Run,
    args: Value,
) -> Value {
    let id = super::new_id();
    run.emit(
        "tool",
        json!({"id": id, "name": "import_file", "arguments": args, "status": "running"}),
    );
    let result = match import(server, config, run, &args).await {
        Ok(text) => json!({"content": [{"type": "text", "text": text}], "isError": false}),
        Err(error) => json!({"content": [{"type": "text", "text": error}], "isError": true}),
    };
    run.emit("tool", json!({"id": id, "name": "import_file", "result": result, "status": if result["isError"].as_bool().unwrap_or(false) { "error" } else { "completed" }}));
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file() -> Attachment {
        serde_json::from_value(json!({
            "name": "kunden.csv", "path": "/tmp/kunden.csv", "format": "csv",
            "columns": ["id", "name"], "rows": [["1", "Anna"]], "totalRows": 1
        }))
        .unwrap()
    }

    #[test]
    fn wide_attachments_share_a_bounded_preview_budget() {
        let mut wide = file();
        wide.columns = (0..100).map(|index| format!("column_{index}")).collect();
        wide.rows = vec![vec![Some("🦆".repeat(200)); 100]; 20];
        let files: Vec<_> = (0..10)
            .map(|index| Attachment {
                name: format!("file_{index}.csv"),
                ..wide.clone()
            })
            .collect();
        let preview = prompt(&files);
        assert!(preview.chars().count() < MAX_PROMPT + 2_000);
        for file in &files {
            assert!(preview.contains(&file.name));
        }
        assert!(preview.contains("truncated"));
        assert!(!preview.contains("column_50"));
        assert_eq!(files[0].columns.len(), 100);
        assert_eq!(files[0].rows[0].len(), 100);
        assert_eq!(prompt(&[]), "");
    }

    #[test]
    fn columns_default_to_text_and_validate_types() {
        let plain = columns(&file(), DatabaseKind::Mssql, &json!({})).unwrap();
        assert_eq!(plain[1].data_type, "NVARCHAR(MAX)");
        let typed = columns(
            &file(),
            DatabaseKind::Postgres,
            &json!({"columns": [{"name": "id", "type": "integer"}, {"name": "name", "type": "varchar(80)"}]}),
        )
        .unwrap();
        assert_eq!(typed[0].data_type, "integer");
        assert!(columns(
            &file(),
            DatabaseKind::Postgres,
            &json!({"columns": [{"name": "id", "type": "int"}]})
        )
        .is_err());
        assert!(columns(
            &file(),
            DatabaseKind::Postgres,
            &json!({"columns": [{"name": "id", "type": "int; drop table x"}, {"name": "n", "type": "text"}]})
        )
        .is_err());
        assert!(prompt(&[file()]).contains("1\tAnna"));
    }
}
