use std::io::Write;
use std::path::Path;

use serde_json::Value;

use crate::automation::connection;
use crate::automation::model::{Action, CsvSettings, ExportFormat, ExportSource, IfExists};
use crate::automation::runtime::{StepContext, StepOutcome};
use crate::db::export::{csv_line, csv_row_line, validate_csv_options, CsvExportOptions};
use crate::db::export_formats::{parquet_kinds, AtomicFile, FileFormat, RowSink, SinkSpec};
use crate::db::import::Dialect;
use crate::db::{DatabaseAdapter, DatabaseKind};

use super::{output, xlsx};

pub const QUERY_MAX_ROWS: u64 = 1_000_000;

pub struct FileSpec<'a> {
    pub format: ExportFormat,
    pub csv: Option<&'a CsvSettings>,
    pub sheet_name: Option<&'a str>,
    pub max_rows: Option<u64>,
    pub append: bool,
    pub kind: DatabaseKind,
}

pub struct ExportResult {
    pub rows: u64,
    pub warning: Option<String>,
}

pub async fn export(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Export {
        connection: reference,
        database,
        source,
        format,
        output: spec,
        csv,
        sheet_name,
        max_rows,
    } = config
    else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    if spec.if_exists == IfExists::Append && !appendable(*format) {
        return Err("Anhängen ist nur für CSV, TSV, JSONL, Markdown und SQL möglich.".into());
    }
    let reference = ctx.vars.render(reference)?;
    let database = database
        .as_deref()
        .map(|db| ctx.vars.render(db))
        .transpose()?;
    let resolved = connection::resolve(
        ctx.services,
        ctx.connections,
        &reference,
        database.as_deref(),
    )
    .await?;
    ctx.vars.set_connection(&resolved);
    let source = match source {
        ExportSource::Query { sql } => ExportSource::Query {
            sql: ctx.vars.render_sql(sql, resolved.kind)?,
        },
        ExportSource::Table {
            schema,
            table,
            filter,
        } => ExportSource::Table {
            schema: ctx.vars.render(schema)?,
            table: ctx.vars.render(table)?,
            filter: filter
                .as_deref()
                .map(|filter| ctx.vars.render_sql(filter, resolved.kind))
                .transpose()?
                .filter(|filter| !filter.trim().is_empty()),
        },
    };
    let sheet_name = sheet_name
        .as_deref()
        .map(|name| ctx.vars.render(name))
        .transpose()?;
    let path = output::target_path(ctx, spec, extension(*format))?;
    let adapter = connection::adapter(ctx.services, &resolved)?;
    let result = run_export(
        adapter.as_ref(),
        &source,
        &path,
        &FileSpec {
            format: *format,
            csv: csv.as_ref(),
            sheet_name: sheet_name.as_deref(),
            max_rows: *max_rows,
            append: spec.if_exists == IfExists::Append,
            kind: resolved.kind,
        },
        &ctx.job_id,
    )
    .await?;
    let outputs = output::finish(ctx, spec, path, format_name(*format))?;
    Ok(StepOutcome {
        rows: Some(result.rows),
        outputs,
        warning: result.warning,
        ..Default::default()
    })
}

pub fn appendable(format: ExportFormat) -> bool {
    matches!(
        format,
        ExportFormat::Csv
            | ExportFormat::Tsv
            | ExportFormat::Jsonl
            | ExportFormat::Markdown
            | ExportFormat::Sql
    )
}

pub fn extension(format: ExportFormat) -> &'static str {
    match format {
        ExportFormat::Markdown => "md",
        other => format_name(other),
    }
}

pub fn format_name(format: ExportFormat) -> &'static str {
    match format {
        ExportFormat::Csv => "csv",
        ExportFormat::Tsv => "tsv",
        ExportFormat::Json => "json",
        ExportFormat::Jsonl => "jsonl",
        ExportFormat::Xlsx => "xlsx",
        ExportFormat::Xml => "xml",
        ExportFormat::Html => "html",
        ExportFormat::Parquet => "parquet",
        ExportFormat::Markdown => "markdown",
        ExportFormat::Sql => "sql",
    }
}

pub fn csv_options(format: ExportFormat, settings: Option<&CsvSettings>) -> CsvExportOptions {
    let mut options = match settings {
        Some(settings) => CsvExportOptions {
            delimiter: settings.delimiter.clone(),
            quote: settings.quote.clone(),
            header: settings.header,
            null_text: settings.null_text.clone(),
            line_ending: settings.line_ending.clone(),
            bom: settings.bom,
        },
        None => CsvExportOptions {
            delimiter: ",".into(),
            quote: "\"".into(),
            header: true,
            null_text: String::new(),
            line_ending: "\n".into(),
            bom: false,
        },
    };
    if format == ExportFormat::Tsv {
        options.delimiter = "\t".into();
    }
    options
}

fn streaming_format(format: ExportFormat) -> Option<FileFormat> {
    match format {
        ExportFormat::Csv | ExportFormat::Tsv => Some(FileFormat::Csv),
        ExportFormat::Xml => Some(FileFormat::Xml),
        ExportFormat::Html => Some(FileFormat::Html),
        ExportFormat::Parquet => Some(FileFormat::Parquet),
        _ => None,
    }
}

pub fn select_all(
    kind: DatabaseKind,
    schema: &str,
    table: &str,
    filter: Option<&str>,
) -> Result<String, String> {
    let dialect = Dialect::from_kind(kind)
        .ok_or("Tabellenexport ist für diesen Datenbanktyp nur als Abfrage möglich.")?;
    let mut sql = format!("SELECT * FROM {}", dialect.target(schema, table));
    if let Some(filter) = filter.filter(|filter| !filter.trim().is_empty()) {
        sql.push_str(" WHERE ");
        sql.push_str(filter);
    }
    Ok(sql)
}

pub async fn run_export(
    adapter: &dyn DatabaseAdapter,
    source: &ExportSource,
    path: &Path,
    spec: &FileSpec<'_>,
    job_id: &str,
) -> Result<ExportResult, String> {
    if let ExportSource::Table {
        schema,
        table,
        filter,
    } = source
    {
        if let Some(file_format) = streaming_format(spec.format)
            .filter(|_| spec.kind.capabilities().full_table_export && !spec.append)
        {
            let options = csv_options(spec.format, spec.csv);
            validate_csv_options(&options)?;
            let outcome = adapter
                .export_table_csv(
                    &crate::db::export::TableExportRequest {
                        job_id: job_id.to_string(),
                        schema: schema.clone(),
                        table: table.clone(),
                        filter: filter.clone(),
                        allow_raw_filter: true,
                        order_by: None,
                        order_desc: false,
                        path: path.display().to_string(),
                        options,
                        masks: Vec::new(),
                        max_rows: spec.max_rows.map(|rows| rows.min(i64::MAX as u64) as i64),
                        format: file_format,
                    },
                    &|_| {},
                )
                .await?;
            return Ok(ExportResult {
                rows: outcome.rows.max(0) as u64,
                warning: outcome
                    .truncated
                    .then(|| format!("Export nach {} Zeilen gekürzt.", outcome.rows)),
            });
        }
    }
    let sql = match source {
        ExportSource::Query { sql } => sql.clone(),
        ExportSource::Table {
            schema,
            table,
            filter,
        } => select_all(spec.kind, schema, table, filter.as_deref())?,
    };
    let result = adapter.execute_query(&sql).await?;
    let limit = spec.max_rows.unwrap_or(QUERY_MAX_ROWS).min(QUERY_MAX_ROWS);
    if result.rows.len() as u64 > limit {
        return Err(format!(
            "Ergebnis hat mehr als {limit} Zeilen. Nutze Tabellenexport."
        ));
    }
    let rows = write_file(path, &result.columns, &result.rows, spec)?;
    Ok(ExportResult {
        rows,
        warning: None,
    })
}

pub fn write_file(
    path: &Path,
    columns: &[String],
    rows: &[Value],
    spec: &FileSpec<'_>,
) -> Result<u64, String> {
    let count = rows.len() as u64;
    match spec.format {
        ExportFormat::Csv | ExportFormat::Tsv => {
            let options = csv_options(spec.format, spec.csv);
            validate_csv_options(&options)?;
            let header: Vec<String> = if options.header {
                let names: Vec<Option<String>> = columns.iter().cloned().map(Some).collect();
                vec![csv_line(&names, &options)]
            } else {
                Vec::new()
            };
            let lines: Vec<String> = rows
                .iter()
                .map(|row| csv_row_line(columns, row, &[], &options))
                .collect();
            write_text(
                path,
                spec.append,
                &TextLayout {
                    header: &header,
                    lines: &lines,
                    separator: &options.line_ending,
                    trailing: false,
                    bom: options.bom,
                },
            )?;
        }
        ExportFormat::Json => {
            let text = serde_json::to_string_pretty(rows).map_err(|e| e.to_string())?;
            write_text(
                path,
                false,
                &TextLayout {
                    header: &[],
                    lines: &[text],
                    separator: "\n",
                    trailing: false,
                    bom: false,
                },
            )?;
        }
        ExportFormat::Jsonl => {
            let lines = rows
                .iter()
                .map(|row| serde_json::to_string(row).map_err(|e| e.to_string()))
                .collect::<Result<Vec<_>, _>>()?;
            write_text(
                path,
                spec.append,
                &TextLayout {
                    header: &[],
                    lines: &lines,
                    separator: "\n",
                    trailing: true,
                    bom: false,
                },
            )?;
        }
        ExportFormat::Markdown => {
            let (header, lines) = markdown(columns, rows);
            write_text(
                path,
                spec.append,
                &TextLayout {
                    header: &header,
                    lines: &lines,
                    separator: "\n",
                    trailing: false,
                    bom: false,
                },
            )?;
        }
        ExportFormat::Sql => {
            let lines = insert_statements(
                spec.kind,
                spec.sheet_name
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or("export"),
                columns,
                rows,
            )?;
            write_text(
                path,
                spec.append,
                &TextLayout {
                    header: &[],
                    lines: &lines,
                    separator: "\n",
                    trailing: true,
                    bom: false,
                },
            )?;
        }
        ExportFormat::Xlsx => {
            let header = spec.csv.is_none_or(|csv| csv.header);
            let null_text = spec.csv.map(|csv| csv.null_text.as_str()).unwrap_or("");
            xlsx::write(
                path,
                columns,
                rows,
                &xlsx::XlsxOptions {
                    sheet_name: spec
                        .sheet_name
                        .filter(|name| !name.trim().is_empty())
                        .unwrap_or(xlsx::DEFAULT_SHEET_NAME),
                    header,
                    null_text,
                },
            )?;
        }
        ExportFormat::Xml | ExportFormat::Html | ExportFormat::Parquet => {
            let format = streaming_format(spec.format).expect("Zeilenformat");
            let kinds = if format == FileFormat::Parquet {
                parquet_kinds(columns, &[], rows, &[])
            } else {
                Vec::new()
            };
            let target = path.display().to_string();
            let mut sink = RowSink::create(SinkSpec {
                format,
                path: &target,
                columns,
                kinds,
                csv: None,
                title: Some(spec.sheet_name.unwrap_or("Export")),
            })?;
            for row in rows {
                if let Err(error) = sink.write_row(columns, row, &[], None) {
                    sink.abort();
                    return Err(error);
                }
            }
            sink.finish()?;
        }
    }
    Ok(count)
}

struct TextLayout<'a> {
    header: &'a [String],
    lines: &'a [String],
    separator: &'a str,
    trailing: bool,
    bom: bool,
}

fn write_text(path: &Path, append: bool, layout: &TextLayout<'_>) -> Result<(), String> {
    let existing = std::fs::metadata(path).map(|meta| meta.len()).unwrap_or(0);
    if append && existing > 0 {
        if layout.lines.is_empty() {
            return Ok(());
        }
        let mut text = String::new();
        if !layout.trailing {
            text.push_str(layout.separator);
        }
        text.push_str(&layout.lines.join(layout.separator));
        if layout.trailing {
            text.push_str(layout.separator);
        }
        let mut file = std::fs::OpenOptions::new()
            .append(true)
            .open(path)
            .map_err(|e| format!("Datei kann nicht geöffnet werden: {e}"))?;
        file.write_all(text.as_bytes())
            .map_err(|e| format!("Schreibfehler: {e}"))?;
        return file.sync_all().map_err(|e| format!("Schreibfehler: {e}"));
    }
    let mut file = AtomicFile::create(&path.display().to_string())?;
    if layout.bom {
        file.write("\u{feff}")?;
    }
    let all: Vec<&String> = layout.header.iter().chain(layout.lines.iter()).collect();
    for (index, line) in all.iter().enumerate() {
        if index > 0 {
            file.write(layout.separator)?;
        }
        file.write(line)?;
    }
    if layout.trailing && !all.is_empty() {
        file.write(layout.separator)?;
    }
    file.finish()
}

fn plain_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

pub fn markdown(columns: &[String], rows: &[Value]) -> (Vec<String>, Vec<String>) {
    let cell = |text: &str| {
        text.replace('|', "\\|")
            .replace("\r\n", " ")
            .replace('\n', " ")
    };
    let header = vec![
        format!(
            "| {} |",
            columns
                .iter()
                .map(|column| cell(column))
                .collect::<Vec<_>>()
                .join(" | ")
        ),
        format!(
            "| {} |",
            columns
                .iter()
                .map(|_| "---")
                .collect::<Vec<_>>()
                .join(" | ")
        ),
    ];
    let lines = rows
        .iter()
        .map(|row| {
            format!(
                "| {} |",
                columns
                    .iter()
                    .map(|column| cell(&plain_text(row.get(column).unwrap_or(&Value::Null))))
                    .collect::<Vec<_>>()
                    .join(" | ")
            )
        })
        .collect();
    (header, lines)
}

pub fn sql_literal(dialect: Dialect, value: &Value, column: &str) -> Result<String, String> {
    match value {
        Value::Null => Ok("NULL".into()),
        Value::Bool(flag) => Ok(match (dialect, flag) {
            (Dialect::Mssql, true) => "1".into(),
            (Dialect::Mssql, false) => "0".into(),
            (_, true) => "TRUE".into(),
            (_, false) => "FALSE".into(),
        }),
        Value::Number(number) => Ok(number.to_string()),
        Value::String(text) => {
            if text.contains('\u{0}') {
                return Err(format!("Spalte \"{column}\": Text enthält ein Nullbyte."));
            }
            Ok(dialect.text_literal(text))
        }
        other => Ok(dialect.text_literal(&other.to_string())),
    }
}

pub fn insert_statements(
    kind: DatabaseKind,
    target: &str,
    columns: &[String],
    rows: &[Value],
) -> Result<Vec<String>, String> {
    let dialect = Dialect::from_kind(kind).unwrap_or(Dialect::Postgres);
    let columns: Vec<&String> = columns
        .iter()
        .filter(|column| column.as_str() != "__ctid__")
        .collect();
    if columns.is_empty() {
        return Err("Keine Spalten für den Export vorhanden.".into());
    }
    let target = dialect.target("", target);
    let list = columns
        .iter()
        .map(|column| dialect.quote(column))
        .collect::<Vec<_>>()
        .join(", ");
    rows.iter()
        .map(|row| {
            let values = columns
                .iter()
                .map(|column| {
                    sql_literal(dialect, row.get(*column).unwrap_or(&Value::Null), column)
                })
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            Ok(format!("INSERT INTO {target} ({list}) VALUES ({values});"))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::model::CsvSettings;

    fn fixture() -> (tempfile::TempDir, Box<dyn DatabaseAdapter>) {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("data.sqlite");
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, betrag REAL, tag TEXT, note TEXT);
             INSERT INTO t VALUES (1, 'Zoë \"quoted\", ok', 12.5, '2026-10-04', NULL);
             INSERT INTO t VALUES (2, '日本語 🚀', -3, '2026-10-04 07:30:00', 'a|b
line');
             INSERT INTO t VALUES (3, NULL, 0, NULL, '');",
        )
        .unwrap();
        drop(conn);
        let adapter = crate::db::create_adapter_from_string(
            DatabaseKind::Sqlite,
            &db.display().to_string(),
            None,
            crate::db::pool::create_pool_state(),
        )
        .unwrap();
        (dir, adapter)
    }

    fn spec(format: ExportFormat) -> FileSpec<'static> {
        FileSpec {
            format,
            csv: None,
            sheet_name: None,
            max_rows: None,
            append: false,
            kind: DatabaseKind::Sqlite,
        }
    }

    fn table() -> ExportSource {
        ExportSource::Table {
            schema: "main".into(),
            table: "t".into(),
            filter: None,
        }
    }

    async fn export_to(
        adapter: &dyn DatabaseAdapter,
        dir: &Path,
        format: ExportFormat,
    ) -> std::path::PathBuf {
        let path = dir.join(format!("out.{}", extension(format)));
        let result = run_export(adapter, &table(), &path, &spec(format), "job")
            .await
            .unwrap();
        assert_eq!(result.rows, 3);
        path
    }

    #[tokio::test]
    async fn csv_and_tsv_are_byte_exact() {
        let (dir, adapter) = fixture();
        let csv = std::fs::read_to_string(
            export_to(adapter.as_ref(), dir.path(), ExportFormat::Csv).await,
        )
        .unwrap();
        assert_eq!(
            csv,
            "id,name,betrag,tag,note\n1,\"Zoë \"\"quoted\"\", ok\",12.5,2026-10-04,\n2,日本語 🚀,-3.0,2026-10-04 07:30:00,\"a|b\nline\"\n3,,0.0,,\"\""
        );
        let tsv = std::fs::read_to_string(
            export_to(adapter.as_ref(), dir.path(), ExportFormat::Tsv).await,
        )
        .unwrap();
        assert_eq!(
            tsv,
            "id\tname\tbetrag\ttag\tnote\n1\t\"Zoë \"\"quoted\"\", ok\"\t12.5\t2026-10-04\t\n2\t日本語 🚀\t-3.0\t2026-10-04 07:30:00\t\"a|b\nline\"\n3\t\t0.0\t\t\"\""
        );
        let settings = CsvSettings {
            delimiter: ";".into(),
            quote: "\"".into(),
            header: false,
            null_text: "NULL".into(),
            line_ending: "\r\n".into(),
            bom: true,
        };
        let path = dir.path().join("custom.csv");
        let mut custom = spec(ExportFormat::Csv);
        custom.csv = Some(&settings);
        run_export(
            adapter.as_ref(),
            &ExportSource::Query {
                sql: "SELECT id, note FROM t ORDER BY id".into(),
            },
            &path,
            &custom,
            "job",
        )
        .await
        .unwrap();
        assert_eq!(
            std::fs::read(&path).unwrap(),
            "\u{feff}1;NULL\r\n2;\"a|b\nline\"\r\n3;\"\"".as_bytes()
        );
    }

    #[tokio::test]
    async fn json_and_jsonl_parse() {
        let (dir, adapter) = fixture();
        let json: Value = serde_json::from_str(
            &std::fs::read_to_string(
                export_to(adapter.as_ref(), dir.path(), ExportFormat::Json).await,
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(json.as_array().unwrap().len(), 3);
        assert_eq!(json[1]["name"], "日本語 🚀");
        assert_eq!(json[0]["note"], Value::Null);
        assert_eq!(json[0]["betrag"], 12.5);
        let text = std::fs::read_to_string(
            export_to(adapter.as_ref(), dir.path(), ExportFormat::Jsonl).await,
        )
        .unwrap();
        assert!(text.ends_with('\n'));
        let lines: Vec<Value> = text
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect();
        assert_eq!(lines.len(), 3);
        assert_eq!(lines[2]["id"], 3);
        let first = text.lines().next().unwrap();
        assert!(first.starts_with("{\"id\":1,\"name\""), "{first}");
    }

    #[tokio::test]
    async fn markdown_sql_xml_html() {
        let (dir, adapter) = fixture();
        let md = std::fs::read_to_string(
            export_to(adapter.as_ref(), dir.path(), ExportFormat::Markdown).await,
        )
        .unwrap();
        assert_eq!(
            md,
            "| id | name | betrag | tag | note |\n| --- | --- | --- | --- | --- |\n| 1 | Zoë \"quoted\", ok | 12.5 | 2026-10-04 |  |\n| 2 | 日本語 🚀 | -3.0 | 2026-10-04 07:30:00 | a\\|b line |\n| 3 |  | 0.0 |  |  |"
        );
        let sql = std::fs::read_to_string(
            export_to(adapter.as_ref(), dir.path(), ExportFormat::Sql).await,
        )
        .unwrap();
        assert_eq!(
            sql.lines().next().unwrap(),
            "INSERT INTO \"export\" (\"id\", \"name\", \"betrag\", \"tag\", \"note\") VALUES (1, 'Zoë \"quoted\", ok', 12.5, '2026-10-04', NULL);"
        );
        assert!(sql.ends_with(";\n"));
        let restored = rusqlite::Connection::open_in_memory().unwrap();
        restored
            .execute_batch(&format!(
                "CREATE TABLE export (id, name, betrag, tag, note); {sql}"
            ))
            .unwrap();
        let name: String = restored
            .query_row("SELECT name FROM export WHERE id = 2", [], |row| row.get(0))
            .unwrap();
        assert_eq!(name, "日本語 🚀");
        let xml = std::fs::read_to_string(
            export_to(adapter.as_ref(), dir.path(), ExportFormat::Xml).await,
        )
        .unwrap();
        assert!(
            xml.contains("<column name=\"name\">Zoë &quot;quoted&quot;, ok</column>"),
            "{xml}"
        );
        assert!(xml.contains("<column name=\"note\" null=\"true\"/>"));
        let html = std::fs::read_to_string(
            export_to(adapter.as_ref(), dir.path(), ExportFormat::Html).await,
        )
        .unwrap();
        assert!(html.contains("日本語 🚀"));
        assert!(html.contains(">NULL</td>"));
        assert_eq!(
            insert_statements(
                DatabaseKind::Mysql,
                "x",
                &["a".into(), "b".into()],
                &[serde_json::json!({"a": "it's \\", "b": true})]
            )
            .unwrap(),
            vec!["INSERT INTO `x` (`a`, `b`) VALUES ('it''s \\\\', TRUE);".to_string()]
        );
    }

    #[tokio::test]
    async fn xlsx_and_parquet_read_back() {
        use calamine::{Data, Reader};
        let (dir, adapter) = fixture();
        let path = export_to(adapter.as_ref(), dir.path(), ExportFormat::Xlsx).await;
        let mut workbook = calamine::open_workbook_auto(&path).unwrap();
        let range = workbook.worksheet_range("Daten").unwrap();
        assert_eq!(range.get_size(), (4, 5));
        assert_eq!(range.get((2, 1)), Some(&Data::String("日本語 🚀".into())));
        assert_eq!(range.get((1, 2)), Some(&Data::Float(12.5)));
        let path = export_to(adapter.as_ref(), dir.path(), ExportFormat::Parquet).await;
        let reader = parquet::file::serialized_reader::SerializedFileReader::new(
            std::fs::File::open(&path).unwrap(),
        )
        .unwrap();
        use parquet::file::reader::FileReader;
        assert_eq!(reader.metadata().file_metadata().num_rows(), 3);
        let rows: Vec<String> = reader
            .into_iter()
            .map(|row| row.unwrap().to_string())
            .collect();
        assert!(rows[1].contains("日本語 🚀"), "{rows:?}");
        assert!(rows[0].contains("12.5"), "{rows:?}");
    }

    #[tokio::test]
    async fn append_writes_header_only_for_new_file() {
        let (dir, adapter) = fixture();
        let path = dir.path().join("log.csv");
        let mut append = spec(ExportFormat::Csv);
        append.append = true;
        let source = ExportSource::Query {
            sql: "SELECT id FROM t WHERE id < 3 ORDER BY id".into(),
        };
        run_export(adapter.as_ref(), &source, &path, &append, "job")
            .await
            .unwrap();
        run_export(adapter.as_ref(), &source, &path, &append, "job")
            .await
            .unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "id\n1\n2\n1\n2");
        let path = dir.path().join("log.jsonl");
        append.format = ExportFormat::Jsonl;
        for _ in 0..2 {
            run_export(adapter.as_ref(), &source, &path, &append, "job")
                .await
                .unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(&path).unwrap(),
            "{\"id\":1}\n{\"id\":2}\n{\"id\":1}\n{\"id\":2}\n"
        );
        assert!(!appendable(ExportFormat::Json));
        assert!(!appendable(ExportFormat::Xlsx));
    }

    #[tokio::test]
    async fn table_source_uses_query_path_and_max_rows() {
        let (dir, adapter) = fixture();
        assert!(!DatabaseKind::Sqlite.capabilities().full_table_export);
        assert!(!DatabaseKind::Duckdb.capabilities().full_table_export);
        let filtered = ExportSource::Table {
            schema: "main".into(),
            table: "t".into(),
            filter: Some("id >= 2".into()),
        };
        let path = dir.path().join("f.csv");
        let result = run_export(
            adapter.as_ref(),
            &filtered,
            &path,
            &spec(ExportFormat::Csv),
            "job",
        )
        .await
        .unwrap();
        assert_eq!(result.rows, 2);
        let mut limited = spec(ExportFormat::Csv);
        limited.max_rows = Some(2);
        let error = run_export(adapter.as_ref(), &table(), &path, &limited, "job")
            .await
            .err()
            .unwrap();
        assert_eq!(
            error,
            "Ergebnis hat mehr als 2 Zeilen. Nutze Tabellenexport."
        );
        assert_eq!(
            select_all(DatabaseKind::Mysql, "s", "t`x", Some("a = 1")).unwrap(),
            "SELECT * FROM `s`.`t``x` WHERE a = 1"
        );
    }

    #[tokio::test]
    #[ignore]
    async fn postgres_table_streams_via_export_table_csv() {
        let url = std::env::var("L8DB_E2E_PG_URL")
            .unwrap_or_else(|_| "postgres://postgres:testpw@127.0.0.1:5433/testdb".into());
        let adapter = crate::db::create_adapter_from_string(
            DatabaseKind::Postgres,
            &url,
            None,
            crate::db::pool::create_pool_state(),
        )
        .unwrap();
        adapter
            .execute_query("DROP TABLE IF EXISTS automation_export_e2e")
            .await
            .unwrap();
        adapter
            .execute_query("CREATE TABLE automation_export_e2e AS SELECT g AS id, 'ä' || g AS name FROM generate_series(1, 2500) g")
            .await
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("pg.csv");
        let mut pg = spec(ExportFormat::Csv);
        pg.kind = DatabaseKind::Postgres;
        let result = run_export(
            adapter.as_ref(),
            &ExportSource::Table {
                schema: "public".into(),
                table: "automation_export_e2e".into(),
                filter: Some("id <= 2000".into()),
            },
            &path,
            &pg,
            "automation-e2e",
        )
        .await
        .unwrap();
        assert_eq!(result.rows, 2000);
        assert_eq!(
            std::fs::read_to_string(&path).unwrap().lines().count(),
            2001
        );
        adapter
            .execute_query("DROP TABLE automation_export_e2e")
            .await
            .unwrap();
    }
}
