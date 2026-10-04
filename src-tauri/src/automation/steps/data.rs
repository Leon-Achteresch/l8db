use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};

use crate::automation::connection::{self, Resolved};
use crate::automation::model::{
    Action, CompareSideConfig, CopyModeConfig, ImportColumn, ImportConflict, ImportFileFormat,
    LogLevel, SchemaPairConfig, TableCopyItem,
};
use crate::automation::runtime::{StepContext, StepOutcome};
use crate::db::backup::{self, BackupOptions, BackupOutcome, BackupRequest};
use crate::db::pool::PoolState;
use crate::db::transaction::TransactionState;
use crate::db::{data_compare, datagen, table_copy, transfer, DatabaseKind};

use super::output;

fn read_only_error(resolved: &Resolved, what: &str) -> Result<(), String> {
    if resolved.read_only {
        Err(format!(
            "Lesemodus: {what} ist für „{}“ gesperrt.",
            resolved.name
        ))
    } else {
        Ok(())
    }
}

async fn resolve(
    ctx: &mut StepContext<'_>,
    reference: &str,
    database: Option<&str>,
) -> Result<Arc<Resolved>, String> {
    let reference = ctx.vars.render(reference)?;
    let database = database.map(|db| ctx.vars.render(db)).transpose()?;
    let resolved = connection::resolve(
        ctx.services,
        ctx.connections,
        &reference,
        database.as_deref(),
    )
    .await?;
    ctx.vars.set_connection(&resolved);
    Ok(resolved)
}

fn backup_options(options: &Value) -> Result<BackupOptions, String> {
    if options.is_null() {
        return Ok(BackupOptions::default());
    }
    serde_json::from_value(options.clone())
        .map_err(|e| format!("Ungültige Sicherungsoptionen: {e}"))
}

pub fn backup_extension(kind: DatabaseKind, options: &BackupOptions) -> &'static str {
    match kind {
        DatabaseKind::Sqlite => "sqlite",
        DatabaseKind::Duckdb => "duckdb",
        DatabaseKind::Mssql => "bak",
        DatabaseKind::Postgres => match options.format.as_str() {
            "plain" => "sql",
            "tar" => "tar",
            "directory" => "",
            _ => "dump",
        },
        _ => "sql",
    }
}

struct Progress {
    lines: Arc<Mutex<Vec<String>>>,
}

impl Progress {
    fn new() -> (Self, backup::Emit) {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = lines.clone();
        let emit: backup::Emit = Arc::new(move |name: &str, value: Value| {
            if let Ok(mut lines) = sink.lock() {
                if lines.len() < 200 {
                    lines.push(format!("{name}: {value}"));
                }
            }
        });
        (Progress { lines }, emit)
    }

    fn flush(self, log: &(dyn Fn(LogLevel, String) + Send + Sync)) {
        if let Ok(lines) = self.lines.lock() {
            for line in lines.iter() {
                log(LogLevel::Debug, line.clone());
            }
        }
    }
}

pub async fn run_backup(
    resolved: &Resolved,
    path: &Path,
    options: BackupOptions,
    tool_paths: HashMap<String, String>,
    emit: backup::Emit,
    job_id: Option<String>,
    pool: PoolState,
) -> Result<BackupOutcome, String> {
    backup::backup(
        resolved.kind,
        &resolved.url,
        resolved.database.as_deref(),
        &BackupRequest {
            path: path.display().to_string(),
            options,
            tool_paths,
        },
        emit,
        job_id,
        pool,
    )
    .await
}

pub async fn run_restore(
    resolved: &Resolved,
    path: &Path,
    options: BackupOptions,
    tool_paths: HashMap<String, String>,
    allow_production: bool,
    emit: backup::Emit,
    job_id: Option<String>,
    pool: PoolState,
) -> Result<BackupOutcome, String> {
    if resolved.read_only {
        return Err("Lesemodus: Wiederherstellung ist für diese Verbindung gesperrt.".into());
    }
    if !allow_production
        && resolved
            .environment
            .as_deref()
            .is_some_and(|env| env.trim().eq_ignore_ascii_case("production"))
    {
        return Err(
            "Wiederherstellung in eine Produktionsverbindung ist nicht freigegeben.".into(),
        );
    }
    backup::restore(
        resolved.kind,
        &resolved.url,
        resolved.database.as_deref(),
        &BackupRequest {
            path: path.display().to_string(),
            options,
            tool_paths,
        },
        emit,
        job_id,
        pool,
    )
    .await
}

pub async fn backup(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Backup {
        connection: reference,
        database,
        output: spec,
        options,
    } = config
    else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    let resolved = resolve(ctx, reference, database.as_deref()).await?;
    let options = backup_options(options)?;
    let settings = ctx.services.store.settings().await?;
    let path = output::target_path(ctx, spec, backup_extension(resolved.kind, &options))?;
    let (progress, emit) = Progress::new();
    let result = run_backup(
        &resolved,
        &path,
        options,
        settings.backup_tool_paths.into_iter().collect(),
        emit,
        Some(ctx.job_id.clone()),
        ctx.services.pool.clone(),
    )
    .await;
    progress.flush(ctx.log);
    let outcome = result?;
    let outputs = output::finish(ctx, spec, outcome.path.clone().into(), "backup")?;
    Ok(StepOutcome {
        outputs,
        message: Some(outcome.command),
        ..Default::default()
    })
}

pub async fn restore(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Restore {
        connection: reference,
        database,
        path,
        options,
        allow_production,
    } = config
    else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    let resolved = resolve(ctx, reference, database.as_deref()).await?;
    let path = output::path(ctx, path)?;
    let settings = ctx.services.store.settings().await?;
    let (progress, emit) = Progress::new();
    let result = run_restore(
        &resolved,
        &path,
        backup_options(options)?,
        settings.backup_tool_paths.into_iter().collect(),
        *allow_production,
        emit,
        Some(ctx.job_id.clone()),
        ctx.services.pool.clone(),
    )
    .await;
    progress.flush(ctx.log);
    let outcome = result?;
    Ok(StepOutcome {
        message: Some(
            outcome
                .log_tail
                .iter()
                .rev()
                .take(5)
                .rev()
                .cloned()
                .collect::<Vec<_>>()
                .join("\n"),
        )
        .filter(|text| !text.is_empty())
        .or(Some(outcome.command)),
        ..Default::default()
    })
}

fn endpoint(resolved: &Resolved) -> transfer::Endpoint {
    transfer::Endpoint {
        kind: resolved.kind,
        connection_string: resolved.url.clone(),
        database: resolved.database.clone(),
    }
}

pub async fn run_transfer(
    source: &Resolved,
    target: &Resolved,
    schemas: &[SchemaPairConfig],
    fold_names: bool,
    pool: PoolState,
) -> Result<transfer::TransferOutcome, String> {
    read_only_error(target, "Schreiben")?;
    let plan = transfer::plan(
        &endpoint(target),
        &transfer::PlanRequest {
            source: endpoint(source),
            schemas: schemas
                .iter()
                .map(|pair| transfer::SchemaPair {
                    source: pair.source.clone(),
                    target: pair.target.clone(),
                })
                .collect(),
            fold_names,
        },
        pool.clone(),
    )
    .await?;
    if !plan.conflicts.is_empty() {
        return Err(format!(
            "Zieltabellen existieren bereits: {}",
            plan.conflicts.join(", ")
        ));
    }
    let outcome = transfer::run(
        &endpoint(target),
        &transfer::RunRequest {
            source: endpoint(source),
            plan,
        },
        pool,
        &|_| {},
    )
    .await?;
    match outcome.error.clone() {
        Some(error) => Err(error),
        None => Ok(outcome),
    }
}

pub async fn transfer(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Transfer {
        source,
        source_database,
        target,
        target_database,
        schemas,
        fold_names,
    } = config
    else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    let source = resolve(ctx, source, source_database.as_deref()).await?;
    let target = resolve(ctx, target, target_database.as_deref()).await?;
    let mut rendered = Vec::with_capacity(schemas.len());
    for pair in schemas {
        rendered.push(SchemaPairConfig {
            source: ctx.vars.render(&pair.source)?,
            target: ctx.vars.render(&pair.target)?,
        });
    }
    let outcome = run_transfer(
        &source,
        &target,
        &rendered,
        *fold_names,
        ctx.services.pool.clone(),
    )
    .await?;
    for warning in &outcome.warnings {
        (ctx.log)(LogLevel::Warn, warning.clone());
    }
    Ok(StepOutcome {
        rows: Some(outcome.rows),
        message: Some(format!("{} Tabellen übertragen.", outcome.tables.len())),
        ..Default::default()
    })
}

pub async fn copy_tables(
    source: &Resolved,
    target: &Resolved,
    tables: &[TableCopyItem],
    mode: CopyModeConfig,
    include_primary_key: bool,
    include_indexes: bool,
    pool: PoolState,
    warn: &(dyn Fn(String) + Send + Sync),
) -> Result<u64, String> {
    read_only_error(target, "Schreiben")?;
    let mode = match mode {
        CopyModeConfig::Create => table_copy::CopyMode::Create,
        CopyModeConfig::Truncate => table_copy::CopyMode::Truncate,
        CopyModeConfig::Append => table_copy::CopyMode::Append,
    };
    let mut rows = 0u64;
    for item in tables {
        let label = format!("{}.{}", item.schema, item.table);
        let outcome = table_copy::copy_table(
            target.kind,
            &target.url,
            target.database.as_deref(),
            pool.clone(),
            &table_copy::TableCopyRequest {
                source: table_copy::CopySource {
                    kind: source.kind,
                    connection_string: source.url.clone(),
                    database: source.database.clone(),
                    schema: item.schema.clone(),
                    table: item.table.clone(),
                },
                target_schema: item.target_schema.clone(),
                target_table: item.target_table.clone(),
                mode,
                include_primary_key,
                include_indexes,
                dry_run: false,
            },
        )
        .await
        .map_err(|e| format!("{label}: {e}"))?;
        for warning in outcome.warnings {
            warn(format!("{label}: {warning}"));
        }
        if let Some(error) = outcome.error {
            return Err(format!("{label}: {error}"));
        }
        rows += outcome.rows;
    }
    Ok(rows)
}

pub async fn table_copy(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::TableCopy {
        source,
        source_database,
        target,
        target_database,
        tables,
        mode,
        include_primary_key,
        include_indexes,
    } = config
    else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    let source = resolve(ctx, source, source_database.as_deref()).await?;
    let target = resolve(ctx, target, target_database.as_deref()).await?;
    let mut rendered = Vec::with_capacity(tables.len());
    for item in tables {
        rendered.push(TableCopyItem {
            schema: ctx.vars.render(&item.schema)?,
            table: ctx.vars.render(&item.table)?,
            target_schema: ctx.vars.render(&item.target_schema)?,
            target_table: ctx.vars.render(&item.target_table)?,
        });
    }
    let log = ctx.log;
    let rows = copy_tables(
        &source,
        &target,
        &rendered,
        *mode,
        *include_primary_key,
        *include_indexes,
        ctx.services.pool.clone(),
        &|warning| log(LogLevel::Warn, warning),
    )
    .await?;
    Ok(StepOutcome {
        rows: Some(rows),
        ..Default::default()
    })
}

#[allow(clippy::too_many_arguments)]
pub async fn generate(
    resolved: &Resolved,
    schema: &str,
    table: &str,
    rows: u64,
    seed: Option<u64>,
    locale: datagen::Locale,
    transaction: bool,
    pool: &PoolState,
    transactions: &TransactionState,
) -> Result<u64, String> {
    if resolved.read_only {
        return Err("Lesemodus: Testdaten können nicht geschrieben werden.".into());
    }
    let database = datagen::scoped_database(resolved.kind, resolved.database.clone(), schema);
    let adapter = crate::db::create_adapter_from_string(
        resolved.kind,
        &resolved.url,
        database.as_deref(),
        pool.clone(),
    )?;
    let plan = datagen::plan(adapter.as_ref(), resolved.kind, schema, table).await?;
    let outcome = datagen::run(
        adapter.as_ref(),
        resolved.kind,
        &resolved.url,
        database.as_deref(),
        &datagen::DatagenRequest {
            schema: schema.to_string(),
            table: table.to_string(),
            rows,
            batch_size: 500,
            seed: seed.unwrap_or_else(rand::random),
            locale,
            transaction,
            columns: plan.columns,
            unique: plan.unique,
            source: None,
        },
        pool,
        transactions,
    )
    .await?;
    if let Some(error) = outcome.error {
        return Err(error);
    }
    if outcome.cancelled {
        return Err("Testdaten-Erzeugung abgebrochen.".into());
    }
    Ok(outcome.inserted)
}

pub async fn datagen(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Datagen {
        connection: reference,
        database,
        schema,
        table,
        rows,
        seed,
        locale,
        transaction,
    } = config
    else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    let resolved = resolve(ctx, reference, database.as_deref()).await?;
    let schema = ctx.vars.render(schema)?;
    let table = ctx.vars.render(table)?;
    let inserted = generate(
        &resolved,
        &schema,
        &table,
        *rows,
        *seed,
        *locale,
        *transaction,
        &ctx.services.pool,
        &ctx.services.transactions,
    )
    .await?;
    Ok(StepOutcome {
        rows_affected: Some(inserted),
        ..Default::default()
    })
}

pub struct ImportSpec<'a> {
    pub schema: &'a str,
    pub table: &'a str,
    pub file: &'a Path,
    pub format: ImportFileFormat,
    pub delimiter: Option<&'a str>,
    pub has_header: bool,
    pub sheet: Option<&'a str>,
    pub columns: &'a [ImportColumn],
    pub conflict: Option<&'a ImportConflict>,
}

pub async fn import_file(
    resolved: &Resolved,
    spec: &ImportSpec<'_>,
    pool: PoolState,
) -> Result<u64, String> {
    read_only_error(resolved, "Import")?;
    if !resolved.kind.capabilities().csv_import {
        return Err("Dateiimport wird für diesen Datenbanktyp nicht unterstützt.".into());
    }
    if spec.columns.is_empty() {
        return Err("Keine Spalten für den Import zugeordnet.".into());
    }
    let format = match spec.format {
        ImportFileFormat::Csv => crate::db::import_source::ImportFormat::Csv,
        ImportFileFormat::Json => crate::db::import_source::ImportFormat::Json,
        ImportFileFormat::Ndjson => crate::db::import_source::ImportFormat::Ndjson,
        ImportFileFormat::Xlsx => crate::db::import_source::ImportFormat::Xlsx,
        ImportFileFormat::Parquet => crate::db::import_source::ImportFormat::Parquet,
    };
    let request = crate::db::CsvImportRequest {
        file: Some(crate::db::csv_stream::CsvFileSource {
            path: spec.file.display().to_string(),
            delimiter: spec
                .delimiter
                .filter(|delimiter| !delimiter.is_empty())
                .unwrap_or(",")
                .to_string(),
            quote: "\"".into(),
            has_header: spec.has_header,
            empty_as_null: true,
            indices: spec.columns.iter().map(|column| column.source).collect(),
            format,
            sheet: spec.sheet.map(str::to_string),
            skip_rows: 0,
            keys: Vec::new(),
        }),
        conflict: spec.conflict.map(|conflict| crate::db::CsvConflict {
            constraint: conflict.constraint.clone(),
            update_columns: conflict.update_columns.clone(),
        }),
        schema: spec.schema.to_string(),
        table: spec.table.to_string(),
        columns: spec
            .columns
            .iter()
            .map(|column| column.target.clone())
            .collect(),
        rows: Vec::new(),
    };
    let database = resolved.database.as_deref();
    let outcome = match crate::db::import::Dialect::from_kind(resolved.kind) {
        Some(crate::db::import::Dialect::Postgres) | None => {
            crate::db::create_adapter_from_string(resolved.kind, &resolved.url, database, pool)?
                .csv_import(&request)
                .await?
        }
        Some(_) => {
            crate::db::import::import(resolved.kind, &resolved.url, database, pool, &request)
                .await?
        }
    };
    if let Some(row) = outcome.failed_row {
        return Err(format!(
            "Zeile {row}, Spalte {}: {}",
            outcome.failed_column.as_deref().unwrap_or("?"),
            outcome.error.as_deref().unwrap_or("Import fehlgeschlagen.")
        ));
    }
    if let Some(error) = outcome.error {
        return Err(error);
    }
    Ok(outcome.inserted_rows + outcome.updated_rows)
}

pub async fn import(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Import {
        connection: reference,
        database,
        schema,
        table,
        file,
        format,
        delimiter,
        has_header,
        sheet,
        columns,
        conflict,
    } = config
    else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    let resolved = resolve(ctx, reference, database.as_deref()).await?;
    let schema = ctx.vars.render(schema)?;
    let table = ctx.vars.render(table)?;
    let file = output::path(ctx, file)?;
    let sheet = sheet
        .as_deref()
        .map(|sheet| ctx.vars.render(sheet))
        .transpose()?;
    let affected = import_file(
        &resolved,
        &ImportSpec {
            schema: &schema,
            table: &table,
            file: &file,
            format: *format,
            delimiter: delimiter.as_deref(),
            has_header: *has_header,
            sheet: sheet.as_deref(),
            columns,
            conflict: conflict.as_ref(),
        },
        ctx.services.pool.clone(),
    )
    .await?;
    Ok(StepOutcome {
        rows_affected: Some(affected),
        ..Default::default()
    })
}

pub struct CompareOutcome {
    pub counts: Value,
    pub differences: u64,
    pub report: Value,
}

fn compare_side(resolved: &Resolved, side: &CompareSideConfig) -> data_compare::CompareSide {
    data_compare::CompareSide {
        connection_string: resolved.url.clone(),
        database: resolved.database.clone(),
        kind: Some(resolved.kind),
        source: crate::db::snapshot::SnapshotRequest {
            schema: side.schema.clone(),
            table: side.table.clone(),
            filter: side
                .filter
                .clone()
                .filter(|filter| !filter.trim().is_empty()),
            allow_raw_filter: true,
            order_by: None,
            order_desc: false,
            is_view: false,
            max_rows: 1_000_000,
        },
    }
}

pub async fn run_compare(
    left: (&Resolved, &CompareSideConfig),
    right: (&Resolved, &CompareSideConfig),
    key_columns: &[String],
    compare_columns: &[String],
    pool: &PoolState,
) -> Result<CompareOutcome, String> {
    let result = data_compare::compare(
        &data_compare::CompareRequest {
            left: compare_side(left.0, left.1),
            right: compare_side(right.0, right.1),
            key_columns: key_columns.to_vec(),
            compare_columns: compare_columns.to_vec(),
            compare_all: true,
        },
        pool,
    )
    .await?;
    let counts = json!({
        "onlyLeft": result.counts.only_left,
        "onlyRight": result.counts.only_right,
        "changed": result.counts.changed,
        "equal": result.counts.equal,
    });
    let differences =
        (result.counts.only_left + result.counts.only_right + result.counts.changed) as u64;
    let report = json!({
        "counts": counts,
        "rows": result.rows,
        "detailsTruncated": result.details_truncated,
    });
    Ok(CompareOutcome {
        counts,
        differences,
        report,
    })
}

pub fn difference_message(counts: &Value) -> String {
    format!(
        "Daten unterscheiden sich: {} nur links, {} nur rechts, {} geändert.",
        counts["onlyLeft"], counts["onlyRight"], counts["changed"]
    )
}

pub async fn compare(ctx: &mut StepContext<'_>, config: &Action) -> Result<StepOutcome, String> {
    let Action::Compare {
        left,
        right,
        key_columns,
        compare_columns,
        fail_if_different,
        report,
    } = config
    else {
        return Err("Ungültige Schrittkonfiguration.".into());
    };
    let mut sides = Vec::with_capacity(2);
    for side in [left, right] {
        let resolved = resolve(ctx, &side.connection, side.database.as_deref()).await?;
        let rendered = CompareSideConfig {
            connection: side.connection.clone(),
            database: side.database.clone(),
            schema: ctx.vars.render(&side.schema)?,
            table: ctx.vars.render(&side.table)?,
            filter: side
                .filter
                .as_deref()
                .map(|filter| ctx.vars.render_sql(filter, resolved.kind))
                .transpose()?,
        };
        sides.push((resolved, rendered));
    }
    let outcome = run_compare(
        (&sides[0].0, &sides[0].1),
        (&sides[1].0, &sides[1].1),
        key_columns,
        compare_columns,
        &ctx.services.pool,
    )
    .await?;
    let mut outputs = Vec::new();
    if let Some(spec) = report {
        let path = output::target_path(ctx, spec, "json")?;
        let text = serde_json::to_string_pretty(&outcome.report).map_err(|e| e.to_string())?;
        let mut file = crate::db::export_formats::AtomicFile::create(&path.display().to_string())?;
        file.write(&text)?;
        file.finish()?;
        outputs = output::finish(ctx, spec, path, "json")?;
        for output in &outputs {
            (ctx.log)(LogLevel::Info, format!("Bericht: {}", output.path));
        }
    }
    if *fail_if_different && outcome.differences > 0 {
        return Err(difference_message(&outcome.counts));
    }
    Ok(StepOutcome {
        rows: Some(outcome.differences),
        value: Some(outcome.counts),
        outputs,
        ..Default::default()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::automation::connection::Via;

    fn sqlite(path: &Path, sql: &str) -> Resolved {
        let conn = rusqlite::Connection::open(path).unwrap();
        conn.execute_batch(sql).unwrap();
        Resolved {
            id: path.display().to_string(),
            name: "lokal".into(),
            kind: DatabaseKind::Sqlite,
            url: path.display().to_string(),
            database: None,
            read_only: false,
            environment: None,
            via: Via::Direct,
        }
    }

    fn count(path: &Path, sql: &str) -> i64 {
        rusqlite::Connection::open(path)
            .unwrap()
            .query_row(sql, [], |row| row.get(0))
            .unwrap()
    }

    #[tokio::test]
    async fn table_copy_truncate_and_append() {
        let dir = tempfile::tempdir().unwrap();
        let source = sqlite(
            &dir.path().join("a.sqlite"),
            "CREATE TABLE kunden (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
             INSERT INTO kunden VALUES (1, 'Ada'), (2, 'Grace'), (3, 'Zoë');",
        );
        let target_path = dir.path().join("b.sqlite");
        let target = sqlite(
            &target_path,
            "CREATE TABLE kunden_kopie (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
             INSERT INTO kunden_kopie VALUES (99, 'alt');",
        );
        let item = TableCopyItem {
            schema: "main".into(),
            table: "kunden".into(),
            target_schema: "main".into(),
            target_table: "kunden_kopie".into(),
        };
        let pool = crate::db::pool::create_pool_state();
        let rows = copy_tables(
            &source,
            &target,
            std::slice::from_ref(&item),
            CopyModeConfig::Truncate,
            true,
            false,
            pool.clone(),
            &|_| {},
        )
        .await
        .unwrap();
        assert_eq!(rows, 3);
        assert_eq!(count(&target_path, "SELECT COUNT(*) FROM kunden_kopie"), 3);
        assert_eq!(
            count(
                &target_path,
                "SELECT COUNT(*) FROM kunden_kopie WHERE id = 99"
            ),
            0
        );
        let error = copy_tables(
            &source,
            &target,
            std::slice::from_ref(&item),
            CopyModeConfig::Append,
            true,
            false,
            pool.clone(),
            &|_| {},
        )
        .await
        .unwrap_err();
        assert!(error.starts_with("main.kunden:"), "{error}");
        let append_item = TableCopyItem {
            target_table: "kunden_log".into(),
            ..item
        };
        rusqlite::Connection::open(&target_path)
            .unwrap()
            .execute_batch("CREATE TABLE kunden_log (id INTEGER, name TEXT NOT NULL);")
            .unwrap();
        for _ in 0..2 {
            copy_tables(
                &source,
                &target,
                std::slice::from_ref(&append_item),
                CopyModeConfig::Append,
                true,
                false,
                pool.clone(),
                &|_| {},
            )
            .await
            .unwrap();
        }
        assert_eq!(count(&target_path, "SELECT COUNT(*) FROM kunden_log"), 6);
        let locked = Resolved {
            read_only: true,
            ..sqlite(&target_path, "")
        };
        assert!(copy_tables(
            &source,
            &locked,
            &[append_item],
            CopyModeConfig::Append,
            true,
            false,
            pool,
            &|_| {}
        )
        .await
        .unwrap_err()
        .starts_with("Lesemodus"));
    }

    #[tokio::test]
    async fn import_csv_into_sqlite() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("i.sqlite");
        let target = sqlite(
            &db,
            "CREATE TABLE personen (id INTEGER PRIMARY KEY, name TEXT, stadt TEXT);",
        );
        let file = dir.path().join("personen.csv");
        std::fs::write(&file, "nr;name;ort\n1;Ada;London\n2;Zoë;Köln\n3;;\n").unwrap();
        let columns = vec![
            ImportColumn {
                source: 0,
                target: "id".into(),
            },
            ImportColumn {
                source: 1,
                target: "name".into(),
            },
            ImportColumn {
                source: 2,
                target: "stadt".into(),
            },
        ];
        let affected = import_file(
            &target,
            &ImportSpec {
                schema: "main",
                table: "personen",
                file: &file,
                format: ImportFileFormat::Csv,
                delimiter: Some(";"),
                has_header: true,
                sheet: None,
                columns: &columns,
                conflict: None,
            },
            crate::db::pool::create_pool_state(),
        )
        .await
        .unwrap();
        assert_eq!(affected, 3);
        assert_eq!(
            count(&db, "SELECT COUNT(*) FROM personen WHERE stadt = 'Köln'"),
            1
        );
        assert_eq!(
            count(&db, "SELECT COUNT(*) FROM personen WHERE name IS NULL"),
            1
        );
        std::fs::write(&file, "nr;name;ort\nx;Ada;London\n").unwrap();
        let error = import_file(
            &target,
            &ImportSpec {
                schema: "main",
                table: "personen",
                file: &file,
                format: ImportFileFormat::Csv,
                delimiter: Some(";"),
                has_header: true,
                sheet: None,
                columns: &columns,
                conflict: None,
            },
            crate::db::pool::create_pool_state(),
        )
        .await
        .unwrap_err();
        assert!(error.starts_with("Zeile "), "{error}");
    }

    #[tokio::test]
    async fn compare_two_sqlite_files() {
        let dir = tempfile::tempdir().unwrap();
        let left = sqlite(
            &dir.path().join("l.sqlite"),
            "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);
             INSERT INTO t VALUES (1, 'a'), (2, 'b'), (3, 'c');",
        );
        let right = sqlite(
            &dir.path().join("r.sqlite"),
            "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT);
             INSERT INTO t VALUES (1, 'a'), (2, 'B'), (4, 'd');",
        );
        let side = CompareSideConfig {
            connection: "x".into(),
            database: None,
            schema: "main".into(),
            table: "t".into(),
            filter: None,
        };
        let pool = crate::db::pool::create_pool_state();
        let outcome = run_compare(
            (&left, &side),
            (&right, &side),
            &["id".into()],
            &["v".into()],
            &pool,
        )
        .await
        .unwrap();
        assert_eq!(
            outcome.counts,
            json!({"onlyLeft": 1, "onlyRight": 1, "changed": 1, "equal": 1})
        );
        assert_eq!(outcome.differences, 3);
        assert_eq!(
            difference_message(&outcome.counts),
            "Daten unterscheiden sich: 1 nur links, 1 nur rechts, 1 geändert."
        );
        let same = run_compare(
            (&left, &side),
            (&left, &side),
            &["id".into()],
            &["v".into()],
            &pool,
        )
        .await
        .unwrap();
        assert_eq!(same.differences, 0);
    }

    #[tokio::test]
    async fn datagen_fills_sqlite_table() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("g.sqlite");
        let target = sqlite(
            &db,
            "CREATE TABLE kunden (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE, alter_jahre INTEGER, erstellt TEXT);",
        );
        let inserted = generate(
            &target,
            "main",
            "kunden",
            250,
            Some(7),
            datagen::Locale::De,
            true,
            &crate::db::pool::create_pool_state(),
            &crate::db::transaction::create_transaction_state(),
        )
        .await
        .unwrap();
        assert_eq!(inserted, 250);
        assert_eq!(count(&db, "SELECT COUNT(*) FROM kunden"), 250);
        assert_eq!(count(&db, "SELECT COUNT(DISTINCT email) FROM kunden"), 250);
    }

    #[tokio::test]
    async fn backup_and_restore_sqlite() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("app.sqlite");
        let resolved = sqlite(
            &db,
            "CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT); INSERT INTO t (v) VALUES ('a'), ('b');",
        );
        let options = backup_options(&Value::Null).unwrap();
        assert_eq!(backup_extension(DatabaseKind::Sqlite, &options), "sqlite");
        let target = output::plan_target(
            &dir.path().join("sicherung").display().to_string(),
            None,
            backup_extension(DatabaseKind::Sqlite, &options),
            Some("20261004-073000"),
            crate::automation::model::IfExists::Overwrite,
            false,
        )
        .unwrap();
        let emit: backup::Emit = Arc::new(|_, _| {});
        let pool = crate::db::pool::create_pool_state();
        let outcome = run_backup(
            &resolved,
            &target,
            options.clone(),
            HashMap::new(),
            emit.clone(),
            None,
            pool.clone(),
        )
        .await
        .unwrap();
        assert_eq!(Path::new(&outcome.path), target);
        assert!(outcome.bytes.unwrap() > 0);
        rusqlite::Connection::open(&db)
            .unwrap()
            .execute("DELETE FROM t", [])
            .unwrap();
        let production = Resolved {
            environment: Some("production".into()),
            ..sqlite(&db, "")
        };
        let blocked = run_restore(
            &production,
            &target,
            options.clone(),
            HashMap::new(),
            false,
            emit.clone(),
            None,
            pool.clone(),
        )
        .await
        .unwrap_err();
        assert!(blocked.contains("Produktion"), "{blocked}");
        let locked = Resolved {
            read_only: true,
            ..sqlite(&db, "")
        };
        assert_eq!(
            run_restore(
                &locked,
                &target,
                options.clone(),
                HashMap::new(),
                true,
                emit.clone(),
                None,
                pool.clone()
            )
            .await
            .unwrap_err(),
            "Lesemodus: Wiederherstellung ist für diese Verbindung gesperrt."
        );
        run_restore(
            &production,
            &target,
            options,
            HashMap::new(),
            true,
            emit,
            None,
            pool,
        )
        .await
        .unwrap();
        assert_eq!(count(&db, "SELECT COUNT(*) FROM t"), 2);
    }
}
