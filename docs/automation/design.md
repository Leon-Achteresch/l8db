# Automatisierung – Implementierungsvertrag

Stand: 2026-10-04 · Worktree `/Users/leon/l8db-automation`, Branch `feature/automation` · Einführungsversion **0.10.0**

Dieses Dokument ist die einzige verbindliche Quelle für alle Implementierungs-Agenten. Wer davon abweicht, ändert zuerst dieses Dokument (eigener Abschnitt „Änderungen“ am Ende) und informiert die anderen Pakete. Alle Datei- und Funktionsangaben unter „verifiziert“ wurden am 2026-10-04 im Worktree geprüft.

Regeln aus `AGENTS.md`, die hier besonders zählen: keine Kommentare im Code, eine Komponente pro Datei, Oberflächentexte auf Deutsch, alle `invoke()`-Aufrufe in `src/lib/db/`, Rust-Typen und TS-Typen synchron halten, nie ein Direktverbindungs-Fallback bei konfiguriertem Tunnel, Conventional Commits (Commit macht nur der Integrator, nicht die Pakete).

---

## 0. Verifizierte Ausgangslage

| Thema | Fundstelle (verifiziert) | Bedeutung für die Automatisierung |
|---|---|---|
| App-Version | `package.json` und `src-tauri/tauri.conf.json`: `0.9.1`; `src/lib/new-features.ts` registriert bereits Funktionen mit `0.10.0` | Die nächste Release ist `0.10.0` (feat → minor). NEW-Badges der Automatisierung nutzen `0.10.0`. |
| Headless-Verzweigung | `src-tauri/src/lib.rs::run()` prüft `--mcp`, `--check`, `--benchmark`, `--ai-mcp-relay` vor dem Tauri-Builder | `--run-task`, `--automation-tick`, `--list-tasks` werden dort ergänzt. |
| CLI-Muster | `src-tauri/src/check_cli.rs::cli(&[String]) -> i32`, eigene `tokio` current-thread Runtime, Exit 0/1/2 | Vorlage für `automation/cli.rs`. |
| Headless-Verbindungsauflösung | `src-tauri/src/mcp/config.rs` (`McpConnection`, `config_dir()`, `restrict()`, `APP_IDENTIFIER = "com.leon.l8db"`), `src-tauri/src/mcp/server.rs::{with_password, connection_url, adapter}` | Passwort liegt im Schlüsselbund unter der Verbindungs-ID; MCP kann aber weder SSH noch Proxy. Die Automatisierung erweitert genau dieses Muster um Tunnel. |
| Frontend-Sync-Muster | `src/lib/mcp.ts::{mergeMcpConnections, syncMcpConfig, initMcpSync}`, aufgerufen in `src/main.tsx` nach dem Start | Vorlage für `initAutomationSync`. |
| Secrets | `src-tauri/src/db/secrets.rs`: `read_secret(account)` (Release: Keychain-Service `l8db`; Debug: `~/.l8db-dev-secrets.json` bzw. `L8DB_DEV_SECRETS`), Commands `store_secret`/`load_secret`/`delete_secret` | Konten: `<id>` Passwort, `<id>:params` geheime Query-Parameter (`QUERY_SECRET_SUFFIX` in `src/lib/connections/store.ts`), `<id>:ssh`, `<id>:ssh-jumps` (JSON-Array), `<id>:proxy` (`src/lib/ssh/network.ts`). |
| SSH/Proxy | `src-tauri/src/db/ssh/mod.rs`: `SshTunnelManager::{open, open_proxy, close, list}`, `SshTunnelRequest`, `ProxyTunnelRequest`, `SshHopRequest`, `SshAuthRequest` (`ssh/auth.rs`, `#[serde(tag = "method")]`), `create_ssh_state()`, `SshState = Arc<SshTunnelManager>`; `reuse()` verwendet einen Tunnel mit gleicher ID und Signatur wieder | Rust kann Tunnel ohne Frontend öffnen. |
| Tunnel-URL-Umschreibung | `src/lib/ssh/connection-string.ts::{tunneledConnectionString, rewriteHostPort, effectiveConnectionString, readOnlyConnectionString, proxyUserConnectionString}` | Wird für Rust in `automation/connection.rs` nachgebaut (Postgres: `port` + `hostaddr=127.0.0.1`, sonst Host:Port ersetzen). |
| Ausführungskontext | `src-tauri/src/db/execution.rs::{run, run_query, cancel, with_progress, ExecutionOptions{job_id, query_timeout, connection_timeout}}` | Jede Schritt-Ausführung läuft mit eigener `job_id`; Abbruch über `execution::cancel(job_id)`. |
| Adapter | `src-tauri/src/db/mod.rs::{create_adapter_from_string, DatabaseAdapter::{execute_query, execute_script, export_table_csv, csv_import, snapshot_rows}, QueryResult, ScriptStatementResult, TableData, CsvImportRequest, CsvImportOutcome}` | Basis für SQL-, Export-, Import-, Prüf- und Alarmschritte. |
| Export | `src-tauri/src/db/export.rs::{CsvExportOptions, CsvFileWriter, csv_row_line, TableExportRequest, TableExportOutcome, request_cancel, clear_cancel}`, `src-tauri/src/db/export_formats.rs::{FileFormat{Csv,Xml,Html,Parquet}, RowSink, SinkSpec, AtomicFile, write_rows_file, parquet_kinds}` | Rust kann CSV, XML, HTML, Parquet. XLSX/JSON/Markdown/SQL-INSERT gibt es nur im Frontend (`src/lib/xlsx.ts`, `src/lib/export.ts`) und werden in Rust ergänzt. |
| Backup/Restore | `src-tauri/src/db/backup.rs::{backup, restore, BackupRequest{path, options, tool_paths}, BackupOptions (nur Deserialize), BackupOutcome, Emit}` | Direkt aufrufbar, braucht keinen `AppHandle` (`Emit` ist ein `Arc<dyn Fn>`). |
| Transfer | `src-tauri/src/db/transfer.rs::{plan, run, Endpoint, PlanRequest, RunRequest, SchemaPair, TransferOutcome, Progress}` | `run` bricht ab, wenn Zieltabellen existieren (`conflicts`). Nur für leere Ziele geeignet. |
| Tabellenkopie | `src-tauri/src/db/table_copy.rs::{copy_table, TableCopyRequest, CopySource, CopyMode{Create,Truncate,Append}, TableCopyOutcome}` | Wiederkehrende Kopie (Truncate/Append). |
| Testdaten | `src-tauri/src/db/datagen.rs::{plan, run, DatagenRequest, DatagenOutcome, Locale{De,En}}`; `scoped_database` ist privat | Paket WP3 macht `scoped_database` `pub(crate)`. |
| Import | `DatabaseAdapter::csv_import` mit `CsvImportRequest.file = Some(csv_stream::CsvFileSource{path, delimiter, quote, has_header, empty_as_null, indices, format, sheet, skip_rows, keys})`, `import_source::ImportFormat{Csv,Json,Ndjson,Xlsx,Parquet}`, `import::Dialect::quote` | Dateiimport ohne Frontend möglich. |
| Datenvergleich | `src-tauri/src/db/data_compare.rs::{compare, CompareRequest, CompareSide, CompareResult, Counts}`, `snapshot::SnapshotRequest` | Vergleich in Rust; das Sync-Skript entsteht nur im Frontend (`src/lib/data-compare/sync-script.ts`, abhängig von `sqlLiteral` in `src/lib/export.ts`). |
| Task-Center | `src/lib/tasks.ts::{startTask, updateTask, finishTask, useTasksStore}`; Dynamic Island reagiert auf Tasks (`src/lib/dynamic-island.ts::taskMoment`) | Automatisierungsläufe werden als Tasks gespiegelt, damit Task-Center und Island ohne eigene Integration funktionieren. |
| Tool-Tabs, Sidebar | `src/lib/tool-tabs.ts::{ToolId, TOOL_TABS, toolIdForPath}`, `src/features/sidebar/app-sidebar-data.ts::appSidebarData.navMain` | Registrierung `automation`. |
| Routen | `src/routes/_app._workspace.backup.tsx` als Vorlage; `src/routeTree.gen.ts` wird von Vite erzeugt und ist eingecheckt | Neue Route `src/routes/_app._workspace.automation.tsx`; `routeTree.gen.ts` per `bun run build` bzw. Dev-Start regenerieren, nie von Hand bearbeiten. |
| Branching/Snapshot-Scheduler | `useSnapshotScheduler` (`src/lib/branching/scheduler.ts`) und `vault::Schedule` (`src-tauri/src/branching/vault.rs`) existieren **nur als nicht eingecheckter WIP im Haupt-Checkout** `/Users/leon/l8db`, nicht in diesem Worktree | Siehe Abschnitt 13: als Folgepaket spezifiziert, nicht Teil der v1-Pakete. |
| Rust/serde | `rustc 1.95.0`, `serde 1.0.229` | `std::fs::File::try_lock` (seit 1.89) und `#[serde(rename_all_fields = …)]` sind verfügbar. |

---

## 1. Überblick

Neuer Tool-Tab **„Automatisierung“** (Route `/automation`). Nutzer legen Tasks an, die aus Schritten bestehen (SQL, Export, Backup, Prüfung, HTTP, Datei, Bedingung, Schleife …), planen sie (Intervall, täglich, Cron …), werden benachrichtigt (System, E-Mail, Slack/Teams/Discord/Webhook) und sehen eine Lauf-Historie mit Schritt-Zeitleiste.

Architekturentscheidungen:

1. **Alles läuft in Rust.** Ausführung, Planung, Platzhalter, Benachrichtigungen und Historie liegen im Backend (`src-tauri/src/automation/`). Das Frontend ist reine Bedienoberfläche. Dadurch verhalten sich App und Headless-CLI identisch.
2. **Ein Speicher:** SQLite-Datei `automation.db` (über das bereits vorhandene `rusqlite` mit `bundled`), WAL-Modus. Kein JSON-Dateigeflecht, keine neue Lock-Bibliothek.
3. **Verbindungen werden gespiegelt:** Das Frontend synchronisiert eine bereinigte Beschreibung jeder gespeicherten Verbindung (ohne Passwort, ohne Tunnel-Port) in die Datenbank. Rust lädt Secrets aus dem Schlüsselbund und öffnet SSH-/Proxy-Tunnel selbst (Abschnitt 4).
4. **Ein Hintergrund-Eintrag statt Kalender-Übersetzung:** „Im Hintergrund ausführen“ registriert beim Betriebssystem genau einen minütlichen Aufruf `l8db --automation-tick`. Dieser berechnet fällige Tasks mit derselben Logik wie der In-App-Scheduler. Läuft die App, beendet sich der Tick sofort (Heartbeat).
5. **Kein Überlappen:** Ein Lauf hält eine Lease-Zeile in SQLite (prozessübergreifend), die App und CLI gleichermaßen respektieren.

---

## 2. Umfang v1 (gemappt auf `docs/research/automation-features.md`)

| Katalog-Abschnitt | v1 enthält | Bewusst später |
|---|---|---|
| 1 Task-Modell | Tasks mit Name, Beschreibung (Markdown), Ordner (Pfad mit `/`), Tags, aktiv/inaktiv, Schritte, Zeitpläne, Variablen, Umgebungen (benannte Variablen-Sets inkl. Verbindungswahl), Benachrichtigungen, Timeout, Standard-Retry, Auto-Deaktivierung, Aufbewahrung; Duplizieren; Import/Export als JSON; Vorlagen; Suche über Name/Beschreibung/Tags/SQL; Validierungshinweise im Editor; Mehrfachauswahl für Aktivieren/Deaktivieren/Löschen/Exportieren | Grafischer Canvas-Designer, Drucken, Composite aus fremden Wizards („Save as task“ in jedem Dialog), automatische Backups der Definitionen |
| 2 Aktivitäten | SQL (mehrere Verbindungen, Inline oder Datei), Abfrage → Datei (CSV, TSV, JSON, JSONL, XLSX, XML, HTML, Parquet, Markdown, SQL-INSERT), Tabelle → Datei (Streaming), Backup, Wiederherstellung, Schema-Transfer (leere Ziele), Tabellen kopieren, Testdaten, Datei-Import, Datenvergleich mit Bericht, Datenqualitätsprüfung, Abfrage-Alarm, Shell-Befehl, HTTP/Webhook, Dateioperationen (kopieren, verschieben, löschen, Ordner anlegen, existiert, zip, unzip, aufräumen), Benachrichtigung senden, Warten, Variable setzen (auch aus Abfrage, mit Rechnen), Bedingung, Schleife (Abfragezeilen, Verbindungen, Liste, Dateien), anderen Task starten, Log-Eintrag, Fehler auslösen | Data-Compare-**Sync** (Literal-Escaping liegt in TS, Port braucht eigenes Audit), Schema-Vergleich/Drift (Diff-Logik in TS), Dokumentationsgenerator, Reports/Charts, FTP/SFTP, Cloud-Ziele (S3 als Ziel), Google Sheets, KI-Schritt, Human-in-the-loop, Wartungsaufgaben als eigene Typen (per SQL-Schritt möglich) |
| 3 Trigger | Manuell, Intervall, täglich (mehrere Uhrzeiten), wöchentlich (Wochentage), monatlich (Tage, letzter Tag), monatlich relativ (n-ter/letzter Wochentag), Cron (5 oder 6 Felder inkl. `L`, `#`, `W` via `croner`), einmalig, beim App-Start, nach anderem Task (Erfolg/Fehler/immer), Start-/Enddatum, Zeitzone, Ausnahmedaten, Zeitfenster für Intervalle, mehrere Zeitpläne pro Task, Pausieren, verpasste Läufe (überspringen/einmal nachholen), kein Überlappen, nächste 5 Läufe in der Vorschau, Hintergrundmodus | Datei-Watcher, DB-Trigger/LISTEN-NOTIFY, Queue-Trigger, Webhook-Eingang (braucht Server), Jitter, Backfill, CPU-Idle |
| 4 Ablauf | Sequenz, umsortierbar; bei Erfolg/Fehler → nächster Schritt / Sprung / Ende Erfolg / Ende Fehler; Bedingung mit Dann/Sonst-Sprung; Schleifen mit verschachtelten Schritten; Sub-Task synchron oder asynchron; ab Schritt X starten | Parallele Zweige, Trigger-Rules, Setup/Teardown, While-Schleife (per Bedingung + Sprung abbildbar) |
| 5 Fehler/Retry/Timeout | Bei Fehler fortsetzen (= `onFailure: next`), Retry pro Schritt und Task-Standard (Anzahl, Pause, exponentiell, Maximalpause), Timeout pro Schritt und Task, Auto-Deaktivierung nach N Fehlern in Folge, Fehler auslösen, Warnungen (Prüfungen mit Schwere „Warnung“), erneut ab fehlgeschlagenem Schritt, hängende Läufe nach Absturz als „Unterbrochen“ markieren | Liste ignorierter Fehlercodes, Deadline-Alerts, Auto-Replay |
| 6 Variablen | `${var}`, `${var:-default}`, typisierte Variablen (Text, Zahl, Boolean, Datum, Auswahl, Geheim), Abfrage vor manuellem Lauf, CLI-Overrides `--var`, `--env`, Umgebungen, eingebaute Variablen inkl. relativer Datumsangaben, Schritt-Ergebnisse `${step.N.rows}`, `${last.error}`, Filter `|sql`, `|json`, `|url`, `|upper`, `|lower`, Geheimnisse maskiert in Logs | Jinja/Liquid, Parameterdatei (INI), Variablen in Verbindungsfeldern |
| 7 Ausgabe | Dateinamen-Vorlagen, Zeitstempel anhängen, überschreiben/anhängen/umbenennen/abbrechen, ZIP, Aufräumen (älter als N Tage / letzte N behalten), Encoding/BOM/Trennzeichen/NULL-Text, XLSX-Blattname | Datei splitten, Passwort-ZIP (AES), BLOBs als Einzeldateien |
| 8 Benachrichtigungen | Systembenachrichtigung, SMTP (Profile, Test-Mail, Anhänge, Passwort im Schlüsselbund), Slack, Teams, Discord, generischer Webhook (Header, HMAC-SHA256-Signatur), bei Erfolg/Fehler/immer/Alarm, Vorlagen mit Platzhaltern, „nicht senden wenn leer“, Ausgaben anhängen, erst nach letztem Retry | Weitere Kanäle (PagerDuty, Telegram …), Zusammenfassungs-Mails, Bereitschaftszeiten |
| 9 Alarme/Qualität | Abfrage-Alarm (Zeilen/keine Zeilen/Schwellwert/Fehler), Zustände OK/AUSGELÖST/FEHLER, nur bei Zustandswechsel benachrichtigen, erneut erinnern nach N Minuten, „Entwarnung“ senden, Stummschalten bis Zeitpunkt; Prüfungen: Zeilenzahl, Wert mit Toleranz, NOT NULL, eindeutig, erlaubte Werte, Aktualität (Freshness), eigene Abfrage (Zeilen = Verstöße), Schwere Warnung/Fehler | Multi-dimensionale Alarme, Anomalie-Erkennung, Fehlerzeilen speichern |
| 10 Historie | Läufe mit Status, Start, Ende, Dauer, Trigger, Umgebung; Schritt-Zeitleiste (Gantt-Balken), Logs, Ausgaben mit „Im Finder zeigen“, Aufbewahrung (Tage/Anzahl, global und pro Task), Filter (Task, Status, Trigger, Zeitraum, Text), erneut ausführen (Originaldefinition oder aktuelle), ab fehlgeschlagenem Schritt, Export JSON/CSV, Erfolgsrate und Durchschnittsdauer pro Task | Statistik-Dashboards, Ergebnis-Snapshots |
| 11 Headless | `l8db --run-task`, `--list-tasks`, `--automation-tick`, dokumentierte Exit-Codes, `--var`, `--env`, `--json`, „Als Befehl kopieren“, Hintergrundmodus über launchd/systemd/crontab/schtasks | REST-API, Connection-CLI, PowerShell-Cmdlets |
| 12–16 | — | CI/CD-Funktionen, Freigabe-Workflows, Team-Sharing, KI-Workflows, DB-seitige Scheduler gehören zu anderen Features |
| 17 | Snapshot-Zeitplan siehe Abschnitt 13 | Bootstrap-SQL, Makros |

Warum später: Webhook-Eingang, Queue- und DB-Trigger brauchen einen dauerhaft lauschenden Prozess (Server), Data-Compare-Sync und Schema-Drift hängen an TypeScript-Logik, deren Port eigene Sicherheitsprüfungen braucht; Canvas-Designer und Parallelzweige verdoppeln den Editor-Aufwand ohne zusätzliche Fähigkeit gegenüber Sprüngen.

---

## 3. Rust-Modulstruktur

`src-tauri/src/automation/` (in `lib.rs` als `mod automation;` eingebunden). In Klammern das besitzende Arbeitspaket (Abschnitt 11).

| Datei | Verantwortung | Ruft vorhandene Funktionen |
|---|---|---|
| `mod.rs` (WP1) | Moduldeklarationen, `AutomationState`, alle `#[tauri::command]`-Funktionen als dünne Wrapper, `services_from_app(&AppHandle)` | — |
| `model.rs` (WP1) | Alle serde-Typen aus Abschnitt 6 | `crate::db::DatabaseKind` |
| `runtime.rs` (WP1) | `Services`, `Sink`, `AutomationEvent`, `StepContext`, `StepOutcome`, `StartError`, `RunRequest` | `db::pool::PoolState`, `db::ssh::SshState`, `db::transaction::TransactionState` |
| `store.rs` (WP1) | SQLite-Zugriff, Migrationen, Leases, Retention, Heartbeat, Settings | `rusqlite`, `mcp::config::{config_dir, restrict}` |
| `connection.rs` (WP1) | Verbindungsauflösung inkl. Secrets und Tunnel (Abschnitt 4) | `db::secrets::read_secret`, `db::ssh::{SshTunnelManager::open, open_proxy, close}`, `db::create_adapter_from_string`, `db::provider` (`default_port`) |
| `vars.rs` (WP2) | Platzhalter-Engine, eingebaute Variablen, Filter, Rechenausdrücke, Maskierung | `chrono`, `chrono-tz` |
| `engine.rs` (WP2) | Lauf-Lebenszyklus, Ablaufsteuerung, Retry/Timeout, Leases, Schritt-Historie, Abbruch, Task-Center-Events, Aufruf von Benachrichtigungen und `scheduler::on_run_finished` | `db::execution::{run, cancel}` |
| `steps/mod.rs` (WP2) | `pub async fn run(ctx: &mut StepContext<'_>) -> Result<StepOutcome, String>` – Dispatch nach `Action` | — |
| `steps/sql.rs` (WP2) | SQL-Schritt | `DatabaseAdapter::{execute_script, execute_query}` |
| `steps/flow.rs` (WP2) | Warten, Variable setzen, Bedingung, Schleife, Task starten, Log, Fehler auslösen | `engine::execute` (rekursiv, Tiefe ≤ 5) |
| `steps/check.rs` (WP2) | Datenqualitätsprüfungen und Abfrage-Alarm (Auswertung über `alerts.rs`) | `DatabaseAdapter::execute_query`, `db::import::Dialect::quote` |
| `steps/http.rs` (WP2) | HTTP-Schritt | `reqwest` (vorhanden) |
| `steps/shell.rs` (WP2) | Shell-Schritt | `tokio::process` (vorhanden) |
| `steps/output.rs` (WP3) | `OutputSpec` → Zielpfad (Vorlage, Zeitstempel, Kollision), Zippen, Aufräumen | `zip` (neu) |
| `steps/export.rs` (WP3) | Abfrage/Tabelle → Datei in allen Formaten | `DatabaseAdapter::{execute_query, export_table_csv}`, `export::{CsvFileWriter, csv_row_line, CsvExportOptions}`, `export_formats::{RowSink, SinkSpec, parquet_kinds, AtomicFile}` |
| `steps/xlsx.rs` (WP3) | Minimaler XLSX-Writer (Port von `src/lib/xlsx.ts`) | `zip` |
| `steps/files.rs` (WP3) | Datei-Schritte | `std::fs`, `zip` |
| `steps/data.rs` (WP3) | Backup, Restore, Transfer, Tabellenkopie, Testdaten, Import, Datenvergleich | `backup::{backup, restore}`, `transfer::{plan, run}`, `table_copy::copy_table`, `datagen::{plan, run, scoped_database}`, `DatabaseAdapter::csv_import`, `data_compare::compare` |
| `notify.rs` (WP3) | Systembenachrichtigung, SMTP, Webhooks, Vorlagen, Anhänge | `notify-rust`, `lettre` (neu), `reqwest`, `hmac`, `sha2` (vorhanden) |
| `schedule.rs` (WP4) | Reine Zeitlogik: `next_runs`, Fenster, Ausnahmen, Zeitzonen, DST | `croner`, `chrono-tz` (neu) |
| `scheduler.rs` (WP4) | Tokio-Schleife in der App, Headless-Tick, App-Start-Trigger, Nach-Task-Trigger, verpasste Läufe, Heartbeat | `engine::{start, execute}` |
| `alerts.rs` (WP4) | Alarm-Bewertung und Zustandsautomat | — |
| `cli.rs` (WP4) | `--run-task`, `--list-tasks`, `--automation-tick` | `check_cli`-Muster |
| `os_scheduler.rs` (WP4) | launchd/systemd/crontab/schtasks installieren, entfernen, Status | `std::process::Command` |

Die `// datei.rs`-Zeilen in den folgenden Blöcken sind nur Überschriften dieses Dokuments; im Code gilt weiterhin: keine Kommentare.

Feste Rust-Schnittstellen zwischen Paketen (WP1 legt alle Dateien mit genau diesen Signaturen an; die Rümpfe geben bis zur Implementierung `Err("Noch nicht implementiert.".into())` bzw. leere Werte zurück, damit `cargo check` von Anfang an grün ist):

```rust
// runtime.rs (WP1)
pub type Sink = std::sync::Arc<dyn Fn(AutomationEvent) + Send + Sync>;

#[derive(Clone)]
pub struct Services {
    pub store: std::sync::Arc<crate::automation::store::Store>,
    pub pool: crate::db::pool::PoolState,
    pub ssh: crate::db::ssh::SshState,
    pub transactions: crate::db::transaction::TransactionState,
    pub sink: Sink,
    pub headless: bool,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "event", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum AutomationEvent {
    RunStarted { run: RunSummary },
    RunStep { run_id: String, task_id: String, step: StepRun },
    RunLog { run_id: String, line: LogLine },
    RunFinished { run: RunSummary },
    TasksChanged { ids: Vec<String> },
    AlertChanged { alert: AlertState },
}

#[derive(Debug, Clone, Default)]
pub struct RunRequest {
    pub task_id: String,
    pub trigger: TriggerKind,
    pub trigger_detail: Option<String>,
    pub vars: std::collections::BTreeMap<String, String>,
    pub environment: Option<String>,
    pub from_step: Option<String>,
    pub rerun_of: Option<String>,
    pub use_original_definition: bool,
    pub parent_run_id: Option<String>,
    pub depth: u8,
}

#[derive(Debug, Clone, PartialEq)]
pub enum StartError {
    NotFound(String),
    Ambiguous(String),
    Disabled,
    NeedsReview,
    AlreadyRunning(String),
    Invalid(String),
    Store(String),
}

pub struct StepContext<'a> {
    pub services: &'a Services,
    pub run_id: &'a str,
    pub task: &'a Task,
    pub step: &'a Step,
    pub vars: &'a mut crate::automation::vars::Vars,
    pub connections: &'a mut crate::automation::connection::ConnectionCache,
    pub cancel: tokio_util::sync::CancellationToken,
    pub job_id: String,
    pub log: &'a (dyn Fn(LogLevel, String) + Send + Sync),
}

#[derive(Debug, Clone, Default)]
pub struct StepOutcome {
    pub rows: Option<u64>,
    pub rows_affected: Option<u64>,
    pub value: Option<serde_json::Value>,
    pub outputs: Vec<RunOutput>,
    pub vars: std::collections::BTreeMap<String, String>,
    pub flow: Option<Flow>,
    pub warning: Option<String>,
    pub message: Option<String>,
    pub alert: Option<AlertState>,
}
```

```rust
// connection.rs (WP1)
pub struct Resolved {
    pub id: String,
    pub name: String,
    pub kind: DatabaseKind,
    pub url: String,
    pub database: Option<String>,
    pub read_only: bool,
    pub environment: Option<String>,
    pub via: Via,
}
pub enum Via { Direct, Ssh(u16), Proxy(u16) }
pub type ConnectionCache = std::collections::HashMap<String, std::sync::Arc<Resolved>>;
pub async fn resolve(services: &Services, cache: &mut ConnectionCache, reference: &str, database: Option<&str>) -> Result<std::sync::Arc<Resolved>, String>;
pub fn adapter(services: &Services, resolved: &Resolved) -> Result<Box<dyn crate::db::DatabaseAdapter>, String>;
pub async fn forget(services: &Services, connection_id: &str);
pub fn unsupported_reason(connection: &AutomationConnection) -> Option<String>;

// store.rs (WP1) – alle Methoden blockieren nicht (intern spawn_blocking)
pub struct Store { /* privat: Mutex<rusqlite::Connection>, Pfad */ }
impl Store {
    pub fn open_default() -> Result<Self, String>;
    pub fn open(path: &std::path::Path) -> Result<Self, String>;
    pub async fn list_tasks(&self) -> Result<Vec<TaskSummary>, String>;
    pub async fn all_tasks(&self) -> Result<Vec<Task>, String>;
    pub async fn get_task(&self, id: &str) -> Result<Option<Task>, String>;
    pub async fn find_task(&self, id_or_name: &str) -> Result<Task, StartError>;
    pub async fn save_task(&self, task: Task, expected_revision: Option<u64>) -> Result<Task, String>;
    pub async fn delete_tasks(&self, ids: &[String]) -> Result<(), String>;
    pub async fn set_enabled(&self, id: &str, enabled: bool, reason: Option<String>) -> Result<(), String>;
    pub async fn connections(&self) -> Result<Vec<AutomationConnection>, String>;
    pub async fn replace_connections(&self, connections: Vec<AutomationConnection>) -> Result<Vec<String>, String>;
    pub async fn settings(&self) -> Result<AutomationSettings, String>;
    pub async fn save_settings(&self, settings: &AutomationSettings) -> Result<(), String>;
    pub async fn take_lease(&self, task_id: &str, run_id: &str) -> Result<bool, String>;
    pub async fn renew_lease(&self, task_id: &str, run_id: &str) -> Result<(), String>;
    pub async fn release_lease(&self, task_id: &str, run_id: &str) -> Result<(), String>;
    pub async fn running_run(&self, task_id: &str) -> Result<Option<String>, String>;
    pub async fn insert_run(&self, run: &RunSummary, vars: &BTreeMap<String, String>, definition: &Task) -> Result<(), String>;
    pub async fn update_run(&self, run: &RunSummary) -> Result<(), String>;
    pub async fn upsert_step(&self, run_id: &str, step: &StepRun) -> Result<(), String>;
    pub async fn append_logs(&self, run_id: &str, lines: &[LogLine]) -> Result<(), String>;
    pub async fn add_outputs(&self, run_id: &str, outputs: &[RunOutput]) -> Result<(), String>;
    pub async fn list_runs(&self, filter: &RunFilter) -> Result<Vec<RunSummary>, String>;
    pub async fn get_run(&self, run_id: &str) -> Result<Option<RunDetail>, String>;
    pub async fn delete_runs(&self, ids: &[String]) -> Result<u64, String>;
    pub async fn apply_retention(&self, task_id: &str, retention: &Retention) -> Result<u64, String>;
    pub async fn mark_interrupted(&self) -> Result<u32, String>;
    pub async fn task_state(&self, task_id: &str) -> Result<TaskState, String>;
    pub async fn save_task_state(&self, state: &TaskState) -> Result<(), String>;
    pub async fn record_finish(&self, run: &RunSummary) -> Result<TaskState, String>;
    pub async fn alert(&self, task_id: &str, step_id: &str) -> Result<Option<AlertState>, String>;
    pub async fn save_alert(&self, state: &AlertState) -> Result<(), String>;
    pub async fn beat(&self, key: &str) -> Result<(), String>;
    pub async fn beat_at(&self, key: &str) -> Result<Option<chrono::DateTime<chrono::Utc>>, String>;
}
// `record_finish` setzt last_*, consecutive_failures und liefert den neuen Zustand; die Auto-Deaktivierung entscheidet die Engine.
// `replace_connections` liefert die IDs entfernter oder geänderter Verbindungen (für `connection::forget`).
// `list_tasks` berechnet `stats` aus den letzten 50 Läufen je Task.
// `beat`/`beat_at` mit Schlüssel "app_heartbeat" bzw. "last_tick".

// vars.rs (WP2)
pub struct Vars { /* privat */ }
impl Vars {
    pub fn new(task: &Task, run_id: &str, environment: Option<&str>, overrides: &BTreeMap<String, String>, secrets: &BTreeMap<String, String>) -> Result<Self, String>;
    pub fn render(&self, template: &str) -> Result<String, String>;
    pub fn render_sql(&self, template: &str, kind: DatabaseKind) -> Result<String, String>;
    pub fn set(&mut self, name: &str, value: String);
    pub fn set_step(&mut self, index: usize, step_id: &str, outcome: &StepOutcome, status: RunStatus, error: Option<&str>);
    pub fn set_connection(&mut self, resolved: &Resolved);
    pub fn mask(&self, text: &str) -> String;
    pub fn snapshot(&self) -> BTreeMap<String, String>;
}
pub fn calculate(expression: &str) -> Result<f64, String>;
pub fn compare(left: &str, op: Comparator, right: &str) -> Result<bool, String>;

// engine.rs (WP2)
pub async fn start(services: Services, request: RunRequest) -> Result<String, StartError>;
pub async fn execute(services: Services, request: RunRequest) -> Result<RunSummary, StartError>;
pub fn cancel(run_id: &str) -> bool;
pub fn validate(task: &Task, all: &[Task]) -> Vec<ValidationIssue>;

// steps/*.rs – jede Schrittfunktion hat die Form (WP2/WP3)
pub async fn <name>(ctx: &mut StepContext<'_>, config: &<Config>) -> Result<StepOutcome, String>;
// Namen: sql, export, backup, restore, transfer, table_copy, datagen, import, compare,
// check, alert, shell, http, file_copy, file_move, file_delete, mkdir, file_exists,
// zip, unzip, cleanup, notify, wait, set_variable, condition, run_loop, run_task, log, fail
// steps/output.rs (WP3):
pub fn target_path(ctx: &StepContext<'_>, spec: &OutputSpec, extension: &str) -> Result<std::path::PathBuf, String>;
pub fn finish(ctx: &StepContext<'_>, spec: &OutputSpec, written: std::path::PathBuf, format: &str) -> Result<Vec<RunOutput>, String>;

// notify.rs (WP3)
pub async fn dispatch(services: &Services, task: &Task, run: &RunDetail, event: NotifyWhen) -> Vec<String>;
pub async fn send(services: &Services, channel: &ChannelRef, message: &Message) -> Result<(), String>;
pub struct Message { pub title: String, pub body: String, pub attachments: Vec<std::path::PathBuf>, pub payload: serde_json::Value }

// schedule.rs (WP4)
pub fn next_runs(schedule: &Schedule, after: chrono::DateTime<chrono::Utc>, count: usize) -> Result<Vec<chrono::DateTime<chrono::Utc>>, String>;
pub fn next_run(task: &Task, after: chrono::DateTime<chrono::Utc>) -> Option<chrono::DateTime<chrono::Utc>>;
pub fn validate(schedule: &Schedule) -> Result<(), String>;

// scheduler.rs (WP4)
pub fn spawn(services: Services);
pub async fn tick(services: Services) -> TickReport;
pub async fn on_run_finished(services: &Services, run: &RunSummary);
pub async fn reschedule(services: &Services, task_id: &str);

// alerts.rs (WP4)
pub fn evaluate(condition: &AlertCondition, result: &Result<crate::db::QueryResult, String>) -> AlertEvaluation;
pub fn transition(previous: Option<&AlertState>, evaluation: &AlertEvaluation, now: chrono::DateTime<chrono::Utc>, rearm_minutes: Option<u32>) -> (AlertState, Option<NotifyWhen>);

// cli.rs (WP4)
pub fn cli(args: &[String]) -> i32;

// os_scheduler.rs (WP4)
pub fn status(store: &Store) -> BackgroundStatus;
pub fn install() -> Result<BackgroundStatus, String>;
pub fn uninstall() -> Result<BackgroundStatus, String>;
pub fn command_line(task: &Task) -> String;
```

`AutomationState` (in `mod.rs`): `pub struct AutomationState { pub services: std::sync::OnceLock<Services> }`, in `lib.rs` per `.manage(automation::AutomationState::default())` registriert und im `setup`-Hook mit dem `AppHandle` gefüllt (Sink = `app.emit("automation-event", event)`), danach `scheduler::spawn(services)`.

---

## 4. Verbindungen ohne Frontend (kritisches Problem)

### 4.1 Ablauf

1. **Frontend spiegelt** jede nicht temporäre gespeicherte Verbindung als `AutomationConnection` per `automation_sync_connections` (vollständige Ersetzung). Auslöser: Start (nach `initConnectionSecrets`), jede Änderung von `useConnectionsStore.connections` (500 ms entprellt), Änderung von `sshTrustNewHosts` bzw. Backup-Tool-Pfaden. Implementiert in `src/lib/automation/sync.ts::initAutomationSync()`, aufgerufen in `src/main.tsx` direkt neben `initMcpSync` (gleiches `requestAnimationFrame`-Muster).
2. **Bereinigung im Frontend** (`buildAutomationConnection(connection)`):
   - `connectionString`: `effectiveConnectionString` ist nicht nutzbar (braucht Tunnel-Port). Stattdessen: `raw = connection.connectionString` → `stripConnectionSecrets` (`src/lib/connection-export/export.ts`, entfernt Passwort und geheime Query-Parameter) → falls `isReadOnlyConnection(connection) || (isProductionLocked(connection) && capabilitiesFor(kind).read_only_mode)`: `readOnlyConnectionString` → `proxyUserConnectionString`. Ergebnis enthält nie ein Passwort.
   - `readOnly` = dieselbe Bedingung (wird von Rust für Schreib-Schritte zusätzlich geprüft).
   - `ssh`, `proxy`: 1:1 aus `SavedConnection` (ohne Secrets), `tags`: Namen der Tags, `environment`, `vault`.
   - `temporary: true` → wird nicht gespiegelt.
3. **Rust speichert** die Beschreibungen in Tabelle `connections`. Entfällt eine Verbindung, ruft `automation_sync_connections` `connection::forget` (schließt den Automations-Tunnel, entfernt den Pool).
4. **Auflösung zur Laufzeit** (`connection::resolve`):
   1. Referenz auflösen: exakt nach `id`, sonst nach Name (Groß/Klein egal). Mehrdeutiger Name → Fehler `Verbindungsname „X“ ist nicht eindeutig.` Unbekannt → `Verbindung „X“ ist für die Automatisierung nicht verfügbar. Öffne l8db einmal, damit Verbindungen synchronisiert werden.`
   2. `unsupported_reason` prüfen (4.2) → Fehler.
   3. Passwort: für `sqlite`, `duckdb` keins; sonst `read_secret(id)`. Ist die URL mit Benutzer, aber ohne Passwort, und es gibt kein Secret → Fehler `Für „X“ ist kein Passwort im Schlüsselbund gespeichert. Speichere das Passwort in der Verbindung, damit geplante Läufe sie nutzen können.` Einsetzen wie `mcp::server::with_password` (URL: `set_password`; Key-Value-Strings: Ersetzen von `***` bzw. `password=`/`pwd=` anhängen, analog `injectUrlPassword` in `src/lib/secrets.ts`).
   4. Geheime Query-Parameter: `read_secret("<id>:params")` → an die Query anhängen (Port von `withSecretParams`).
   5. Tunnel: wenn `ssh.host` gesetzt → `SshTunnelRequest { id: "automation:<connectionId>", host, port, user, auth, jump_hosts, proxy, remote_host: remote_host oder "127.0.0.1", remote_port, accept_new_host_key: settings.ssh_trust_new_hosts }`. Auth aus `<id>:ssh` (Passwort bzw. Passphrase), Sprung-Hosts aus `<id>:ssh-jumps` (JSON-Array, Index = Hop), Proxy-Passwort aus `<id>:proxy`; fehlendes Passwort bei `auth = password` → Fehler wie in `src/lib/ssh/network.ts::sshAuthRequest` (`SSH: SSH-Passwort fehlt – bitte Verbindung bearbeiten und erneut speichern.`). Sonst wenn `proxy.host` gesetzt → `ProxyTunnelRequest { id: "automation:<connectionId>", proxy, remote_host, remote_port }` mit Ziel aus der URL (Port fehlt → `default_port` des Providers aus `db::provider`). Öffnen über `services.ssh.open(..)` bzw. `open_proxy(..)` innerhalb `execution::connect`.
   6. URL umschreiben: Postgres → `port=<local>` setzen und Query-Parameter `hostaddr`/`port` entfernen, `hostaddr=127.0.0.1` anhängen (wie `tunneledConnectionString`); andere Arten → Authority-Host:Port durch `127.0.0.1:<local>` ersetzen (wie `rewriteHostPort`). Strings ohne `://` mit Tunnel → Fehler `Für Tunnel-Verbindungen wird eine URL-Verbindungszeichenfolge benötigt.`
   7. Tunnelfehler sind harte Fehler. **Es gibt keinen Direktverbindungs-Fallback.** Test `tunnel_failure_never_falls_back_to_direct` (Abschnitt 12) sichert das ab.
5. **Tunnel-Lebensdauer:** In der App bleibt der Tunnel `automation:<connectionId>` offen und wird bei späteren Läufen über `reuse` (gleiche Signatur) wiederverwendet. So bleibt der Pool-Schlüssel (`connection::connection_key` enthält den Port) stabil und der `PoolManager` wächst nicht. Getrennte ID-Präfixe garantieren, dass Automatisierung nie Tunnel der Fenster schließt und umgekehrt. Headless lebt der Tunnel bis Prozessende.

### 4.2 Nicht unterstützte Verbindungen (klare Fehlermeldung, im Editor schon beim Auswählen sichtbar)

| Fall | Erkennung | Meldung |
|---|---|---|
| Temporäre Verbindung (Datei per Drag & Drop) | wird nicht gespiegelt | im Verbindungs-Picker nicht wählbar, Tooltip „Temporäre Verbindungen erst speichern.“ |
| Passwortmanager-Verbindung (`vault: true`) | Flag | „Verbindungen aus dem Passwortmanager können nicht unbeaufsichtigt laufen, weil ihr Passwort nur während der Sitzung vorliegt.“ |
| Objektspeicher (`s3`) | `kind` | „Objektspeicher-Verbindungen unterstützen keine Automatisierungsschritte.“ |
| Schritt passt nicht zur Fähigkeit | `kind.capabilities()` (`full_table_export`, `csv_import`, …) | z. B. „Tabellenexport wird für diesen Datenbanktyp nicht unterstützt.“ |
| Passwort nur für die Sitzung gemerkt (`rememberSecret`) | Laufzeit: kein Secret | Meldung aus 4.1 Schritt 3 |
| AWS-Familien (`dynamodb`, `athena`, `s3`) mit Modus `env` | Laufzeit | funktionieren, solange die Variablen im Prozess gesetzt sind; im Hintergrundmodus fehlen Shell-Variablen. Editor zeigt Hinweis „Im Hintergrund stehen Umgebungsvariablen der Shell nicht zur Verfügung. Nutze ein AWS-Profil.“ `profile` und `keys` funktionieren uneingeschränkt (Schlüsselbund bzw. `~/.aws`). |
| BigQuery/Snowflake mit Schlüsseldatei oder `gcloud` | wie AWS | funktionieren, Dateien müssen für den Benutzer lesbar sein |
| Erweiterungs-Provider, BaaS-Profile (Supabase/Firebase/…) | keine `DatabaseKind` | nicht im Picker |

### 4.3 Mehrere Fenster

Alle Fenster teilen `localStorage` und senden dieselben Daten; die Synchronisation ist idempotent (vollständige Ersetzung, Rust vergleicht einen SHA-256 über das JSON und schreibt nur bei Änderung). Engine und Scheduler existieren genau einmal pro App-Prozess (`AutomationState`). Ereignisse gehen per `app.emit` an alle Fenster; jedes Fenster spiegelt Läufe in sein Task-Center (Task-ID `automation:<runId>` – `startTask` ersetzt gleiche IDs, daher keine Duplikate).

---

## 5. Persistenz

Datei: `mcp::config::config_dir().join("automation.db")` (macOS `~/Library/Application Support/com.leon.l8db/automation.db`, Linux `$XDG_CONFIG_HOME/com.leon.l8db/`, Windows `%APPDATA%\com.leon.l8db\`). Überschreibbar mit `L8DB_AUTOMATION_DB` (absoluter Pfad, für Tests und CLI-E2E). Nach dem Anlegen `mcp::config::restrict(path)` (0600).

Öffnen: `PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL`. Jede schreibende Operation ist eine eigene kurze Transaktion (`BEGIN IMMEDIATE`). App und CLI dürfen gleichzeitig zugreifen; SQLite serialisiert Schreibzugriffe. Der `Store` hält eine `std::sync::Mutex<rusqlite::Connection>` und führt Zugriffe in `tokio::task::spawn_blocking` aus.

Versionierung: `PRAGMA user_version`. Migrationen sind eine geordnete `&[&str]`-Liste in `store.rs`; beim Öffnen werden fehlende Schritte in einer Transaktion angewandt. Ist `user_version` größer als die bekannte Höchstversion → Fehler `Die Automatisierungsdatenbank stammt von einer neueren l8db-Version.` (CLI-Exit 6, App zeigt Banner, nichts wird geschrieben).

Schema v1:

```sql
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE task_state (
  task_id TEXT PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  next_run_at TEXT,
  last_run_at TEXT,
  last_run_id TEXT,
  last_status TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  disabled_reason TEXT,
  schedule_marks TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  task_name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  trigger_detail TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  error TEXT,
  environment TEXT,
  rerun_of TEXT,
  parent_run_id TEXT,
  steps_total INTEGER NOT NULL,
  steps_done INTEGER NOT NULL DEFAULT 0,
  vars_json TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  pid INTEGER NOT NULL
);
CREATE INDEX runs_task_started ON runs(task_id, started_at DESC);
CREATE INDEX runs_started ON runs(started_at DESC);
CREATE TABLE run_steps (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE TABLE run_logs (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  at TEXT NOT NULL,
  level TEXT NOT NULL,
  step_id TEXT,
  message TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);
CREATE TABLE run_outputs (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  path TEXT NOT NULL,
  bytes INTEGER,
  format TEXT NOT NULL
);
CREATE TABLE alerts (
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (task_id, step_id)
);
CREATE TABLE leases (
  task_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  pid INTEGER NOT NULL,
  heartbeat_at TEXT NOT NULL
);
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  json TEXT NOT NULL
);
```

Regeln:

- **Optimistische Sperre:** `automation_save_task(task, expectedRevision)` schreibt nur, wenn `revision` übereinstimmt (bzw. Task neu ist), und erhöht sie. Sonst Fehler `Der Task wurde inzwischen geändert (z. B. in einem anderen Fenster). Lade ihn neu.`
- **Lease (kein Überlappen):** Vor Laufstart `INSERT INTO leases … ON CONFLICT(task_id) DO UPDATE … WHERE leases.heartbeat_at < now - 90s` in `BEGIN IMMEDIATE`. Kein Treffer → `StartError::AlreadyRunning(run_id)`. Die Engine aktualisiert `heartbeat_at` alle 30 s und löscht die Zeile am Ende. Abgestürzte Prozesse geben die Lease nach 90 s frei.
- **Verwaiste Läufe:** Beim Öffnen des Stores in der App und beim Tick werden `runs` mit `status='running'`, deren Lease fehlt oder abgelaufen ist, auf `interrupted` gesetzt (`error = 'Lauf wurde unterbrochen (App oder Prozess beendet).'`).
- **Heartbeat der App:** `settings`-Schlüssel `app_heartbeat` = `{ "at": RFC3339, "pid": u32 }`, alle 30 s vom In-App-Scheduler geschrieben. Tick gilt die App als laufend, wenn `at` jünger als 90 s ist.
- **Retention:** nach jedem Lauf für den Task: `keepRuns` (Standard 200) und `keepDays` (Standard 30) aus `task.retention` oder `settings.default_retention`. Ausgabedateien werden dabei **nicht** gelöscht (das macht nur `OutputSpec.cleanup`).
- **Log-Grenzen:** max. 5 000 Logzeilen pro Lauf, Nachrichten auf 4 000 Zeichen gekürzt; danach eine Zeile `Log gekürzt.`
- **Zeitformat:** alle Zeitpunkte RFC 3339 in UTC mit `Z`. Lokale Angaben (Zeitpläne) siehe Abschnitt 6.
- **IDs:** Tasks, Schritte, Zeitpläne, Benachrichtigungen, SMTP-Profile, Webhooks: vom Frontend per `crypto.randomUUID()`. Lauf-IDs erzeugt Rust: `format!("{:013x}{:06x}", unix_millis, rand)` (sortierbar).
- **Secrets der Automatisierung** liegen im Schlüsselbund, nie in der Datenbank: `automation:smtp:<profileId>` (Passwort), `automation:webhook:<webhookId>` (URL), `automation:webhook:<webhookId>:hmac` (Signaturschlüssel), `automation:var:<taskId>:<variableKey>` (geheime Variable, pro Umgebung `automation:var:<taskId>:<environmentKey>:<variableKey>`; Schlüssel = `id`, sonst Name, siehe §17 REVIEW). Das Frontend schreibt sie mit den vorhandenen Commands `store_secret`/`delete_secret` über `src/lib/secrets.ts::{storeSecret, deleteSecret}`.

---

## 6. Datenmodell

### 6.1 Rust (`src-tauri/src/automation/model.rs`, verbatim übernehmen)

Konventionen: Structs `#[serde(rename_all = "camelCase")]`, Enums `#[serde(rename_all = "snake_case")]`, getaggte Enums zusätzlich `rename_all_fields = "camelCase"`. Zeitpunkte als `String` (RFC 3339 UTC). Lokale Zeitplan-Angaben: Uhrzeit `"HH:MM"`, Datum `"YYYY-MM-DD"`, lokaler Zeitpunkt `"YYYY-MM-DDTHH:MM"`, ausgewertet in `schedule.timezone` (IANA, `None` = Systemzeitzone).

```rust
use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::db::DatabaseKind;

pub const EXPORT_FORMAT: u32 = 1;

fn yes() -> bool {
    true
}

fn item_name() -> String {
    "item".into()
}

fn zero_exit() -> Vec<i32> {
    vec![0]
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub folder: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default = "yes")]
    pub enabled: bool,
    #[serde(default)]
    pub steps: Vec<Step>,
    #[serde(default)]
    pub schedules: Vec<Schedule>,
    #[serde(default)]
    pub variables: Vec<Variable>,
    #[serde(default)]
    pub environments: Vec<Environment>,
    #[serde(default)]
    pub default_environment: Option<String>,
    #[serde(default)]
    pub notifications: Vec<NotificationRule>,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
    #[serde(default)]
    pub retry: Option<RetryPolicy>,
    #[serde(default)]
    pub max_consecutive_failures: Option<u32>,
    #[serde(default)]
    pub missed_runs: MissedRunPolicy,
    #[serde(default)]
    pub background: bool,
    #[serde(default)]
    pub retention: Option<Retention>,
    #[serde(default)]
    pub needs_review: bool,
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub created_at: String,
    #[serde(default)]
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Environment {
    pub name: String,
    #[serde(default)]
    pub variables: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VariableKind {
    #[default]
    Text,
    Number,
    Boolean,
    Date,
    Choice,
    Secret,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Variable {
    pub name: String,
    #[serde(default)]
    pub kind: VariableKind,
    #[serde(default)]
    pub default_value: String,
    #[serde(default)]
    pub choices: Vec<String>,
    #[serde(default)]
    pub prompt: bool,
    #[serde(default)]
    pub description: String,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Backoff {
    #[default]
    Fixed,
    Exponential,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RetryPolicy {
    pub attempts: u32,
    pub delay_seconds: u64,
    #[serde(default)]
    pub backoff: Backoff,
    #[serde(default)]
    pub max_delay_seconds: Option<u64>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MissedRunPolicy {
    Skip,
    #[default]
    RunOnce,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Retention {
    #[serde(default)]
    pub keep_days: Option<u32>,
    #[serde(default)]
    pub keep_runs: Option<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum Flow {
    #[default]
    Next,
    Goto { step_id: String },
    EndSuccess,
    EndFailure,
}

fn fail_flow() -> Flow {
    Flow::EndFailure
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Step {
    pub id: String,
    pub name: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    pub action: Action,
    #[serde(default)]
    pub on_success: Flow,
    #[serde(default = "fail_flow")]
    pub on_failure: Flow,
    #[serde(default)]
    pub retry: Option<RetryPolicy>,
    #[serde(default)]
    pub timeout_seconds: Option<u64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Comparator {
    Eq,
    Ne,
    Gt,
    Gte,
    Lt,
    Lte,
    Contains,
    NotContains,
    Matches,
    Empty,
    NotEmpty,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IfExists {
    #[default]
    Overwrite,
    Append,
    Rename,
    Fail,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cleanup {
    #[serde(default)]
    pub older_than_days: Option<u32>,
    #[serde(default)]
    pub keep_last: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OutputSpec {
    pub path: String,
    #[serde(default)]
    pub append_timestamp: bool,
    #[serde(default)]
    pub if_exists: IfExists,
    #[serde(default)]
    pub zip: bool,
    #[serde(default)]
    pub cleanup: Option<Cleanup>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CsvSettings {
    pub delimiter: String,
    pub quote: String,
    pub header: bool,
    pub null_text: String,
    pub line_ending: String,
    pub bom: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    Csv,
    Tsv,
    Json,
    Jsonl,
    Xlsx,
    Xml,
    Html,
    Parquet,
    Markdown,
    Sql,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ExportSource {
    Query { sql: String },
    Table { schema: String, table: String, #[serde(default)] filter: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SchemaPairConfig {
    pub source: String,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TableCopyItem {
    pub schema: String,
    pub table: String,
    pub target_schema: String,
    pub target_table: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CopyModeConfig {
    Create,
    Truncate,
    Append,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImportFileFormat {
    #[default]
    Csv,
    Json,
    Ndjson,
    Xlsx,
    Parquet,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportColumn {
    pub source: usize,
    pub target: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportConflict {
    pub constraint: String,
    pub update_columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CompareSideConfig {
    pub connection: String,
    #[serde(default)]
    pub database: Option<String>,
    pub schema: String,
    pub table: String,
    #[serde(default)]
    pub filter: Option<String>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Warning,
    #[default]
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum CheckSpec {
    RowCount { schema: Option<String>, table: Option<String>, sql: Option<String>, op: Comparator, value: f64 },
    Value { sql: String, op: Comparator, value: String, #[serde(default)] tolerance: Option<f64> },
    NotNull { schema: String, table: String, column: String },
    Unique { schema: String, table: String, columns: Vec<String> },
    AcceptedValues { schema: String, table: String, column: String, values: Vec<String> },
    Freshness { schema: String, table: String, column: String, #[serde(default)] warn_after_minutes: Option<u32>, error_after_minutes: u32 },
    Query { sql: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum AlertCondition {
    HasRows,
    NoRows,
    Value { #[serde(default)] column: Option<String>, op: Comparator, threshold: String },
    Error,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum VarQueryMode {
    #[default]
    FirstValue,
    RowCount,
    ColumnList,
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VarQuery {
    pub connection: String,
    #[serde(default)]
    pub database: Option<String>,
    pub sql: String,
    #[serde(default)]
    pub mode: VarQueryMode,
    #[serde(default)]
    pub separator: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum LoopSource {
    Query { connection: String, #[serde(default)] database: Option<String>, sql: String },
    Connections { #[serde(default)] connections: Vec<String>, #[serde(default)] tag: Option<String> },
    List { values: String },
    Files { dir: String, pattern: String },
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
pub enum LogLevel {
    Debug,
    #[default]
    Info,
    Warn,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum ChannelRef {
    Native,
    Email { profile_id: String, to: Vec<String>, #[serde(default)] cc: Vec<String> },
    Webhook { webhook_id: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum Action {
    Sql { connections: Vec<String>, #[serde(default)] database: Option<String>, #[serde(default)] sql: String, #[serde(default)] file: Option<String> },
    Export { connection: String, #[serde(default)] database: Option<String>, source: ExportSource, format: ExportFormat, output: OutputSpec, #[serde(default)] csv: Option<CsvSettings>, #[serde(default)] sheet_name: Option<String>, #[serde(default)] max_rows: Option<u64> },
    Backup { connection: String, #[serde(default)] database: Option<String>, output: OutputSpec, #[serde(default)] options: Value },
    Restore { connection: String, #[serde(default)] database: Option<String>, path: String, #[serde(default)] options: Value, #[serde(default)] allow_production: bool },
    Transfer { source: String, #[serde(default)] source_database: Option<String>, target: String, #[serde(default)] target_database: Option<String>, schemas: Vec<SchemaPairConfig>, #[serde(default = "yes")] fold_names: bool },
    TableCopy { source: String, #[serde(default)] source_database: Option<String>, target: String, #[serde(default)] target_database: Option<String>, tables: Vec<TableCopyItem>, mode: CopyModeConfig, #[serde(default = "yes")] include_primary_key: bool, #[serde(default)] include_indexes: bool },
    Datagen { connection: String, #[serde(default)] database: Option<String>, schema: String, table: String, rows: u64, #[serde(default)] seed: Option<u64>, #[serde(default)] locale: crate::db::datagen::Locale, #[serde(default = "yes")] transaction: bool },
    Import { connection: String, #[serde(default)] database: Option<String>, schema: String, table: String, file: String, #[serde(default)] format: ImportFileFormat, #[serde(default)] delimiter: Option<String>, #[serde(default = "yes")] has_header: bool, #[serde(default)] sheet: Option<String>, columns: Vec<ImportColumn>, #[serde(default)] conflict: Option<ImportConflict> },
    Compare { left: CompareSideConfig, right: CompareSideConfig, key_columns: Vec<String>, #[serde(default)] compare_columns: Vec<String>, #[serde(default)] fail_if_different: bool, #[serde(default)] report: Option<OutputSpec> },
    Check { connection: String, #[serde(default)] database: Option<String>, check: CheckSpec, #[serde(default)] severity: Severity },
    Alert { connection: String, #[serde(default)] database: Option<String>, sql: String, condition: AlertCondition, #[serde(default)] rearm_minutes: Option<u32>, #[serde(default = "yes")] notify_on_resolve: bool },
    Shell { program: String, #[serde(default)] args: Vec<String>, #[serde(default)] cwd: Option<String>, #[serde(default)] env: BTreeMap<String, String>, #[serde(default = "zero_exit")] success_codes: Vec<i32>, #[serde(default)] capture: Option<String> },
    Http { method: HttpMethod, url: String, #[serde(default)] headers: BTreeMap<String, String>, #[serde(default)] body: Option<String>, #[serde(default)] expect_status: Option<String>, #[serde(default)] capture: Option<String> },
    FileCopy { from: String, to: String, #[serde(default)] overwrite: bool },
    FileMove { from: String, to: String, #[serde(default)] overwrite: bool },
    FileDelete { path: String },
    Mkdir { path: String },
    FileExists { path: String, #[serde(default = "yes")] fail_if_missing: bool, #[serde(default)] capture: Option<String> },
    Zip { sources: Vec<String>, output: OutputSpec },
    Unzip { archive: String, target: String, #[serde(default)] overwrite: bool },
    Cleanup { dir: String, pattern: String, cleanup: Cleanup },
    Notify { channel: ChannelRef, title: String, body: String, #[serde(default)] attach_outputs: bool },
    Wait { #[serde(default)] seconds: Option<u64>, #[serde(default)] until: Option<String> },
    SetVariable { name: String, #[serde(default)] value: String, #[serde(default)] query: Option<VarQuery>, #[serde(default)] calculate: bool },
    Condition { left: String, op: Comparator, #[serde(default)] right: String, then: Flow, otherwise: Flow },
    Loop { over: LoopSource, steps: Vec<Step>, #[serde(default = "item_name")] item: String, #[serde(default)] max_iterations: Option<u32>, #[serde(default)] continue_on_error: bool },
    RunTask { task: String, #[serde(default = "yes")] wait: bool, #[serde(default)] vars: BTreeMap<String, String>, #[serde(default)] environment: Option<String> },
    Log { #[serde(default)] level: LogLevel, message: String },
    Fail { message: String },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum IntervalUnit {
    Minutes,
    Hours,
    Days,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AfterOutcome {
    Success,
    Failure,
    Always,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum Trigger {
    Interval { every: u32, unit: IntervalUnit },
    Daily { times: Vec<String> },
    Weekly { weekdays: Vec<u8>, times: Vec<String> },
    Monthly { #[serde(default)] days: Vec<u8>, #[serde(default)] last_day: bool, times: Vec<String> },
    MonthlyNth { nth: i8, weekday: u8, times: Vec<String> },
    Cron { expression: String },
    Once { at: String },
    AppStart { #[serde(default)] delay_seconds: u32 },
    AfterTask { task_id: String, on: AfterOutcome },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TimeWindow {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    pub trigger: Trigger,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub start_at: Option<String>,
    #[serde(default)]
    pub end_at: Option<String>,
    #[serde(default)]
    pub exclusions: Vec<String>,
    #[serde(default)]
    pub window: Option<TimeWindow>,
    #[serde(default)]
    pub vars: BTreeMap<String, String>,
    #[serde(default)]
    pub environment: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NotifyWhen {
    Success,
    Failure,
    Always,
    Warning,
    AlertTriggered,
    AlertResolved,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NotificationRule {
    pub id: String,
    #[serde(default = "yes")]
    pub enabled: bool,
    pub when: NotifyWhen,
    pub channel: ChannelRef,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub body: String,
    #[serde(default)]
    pub attach_outputs: bool,
    #[serde(default)]
    pub skip_if_empty: bool,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SmtpSecurity {
    #[default]
    Starttls,
    Tls,
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SmtpProfile {
    pub id: String,
    pub name: String,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub security: SmtpSecurity,
    #[serde(default)]
    pub username: Option<String>,
    pub from: String,
    #[serde(default)]
    pub reply_to: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WebhookKind {
    Slack,
    Teams,
    Discord,
    Generic,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WebhookTarget {
    pub id: String,
    pub name: String,
    pub kind: WebhookKind,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub sign: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationSettings {
    #[serde(default = "yes")]
    pub scheduler_enabled: bool,
    #[serde(default)]
    pub smtp_profiles: Vec<SmtpProfile>,
    #[serde(default)]
    pub webhooks: Vec<WebhookTarget>,
    #[serde(default)]
    pub default_retention: Option<Retention>,
    #[serde(default)]
    pub ssh_trust_new_hosts: bool,
    #[serde(default)]
    pub backup_tool_paths: BTreeMap<String, String>,
    #[serde(default)]
    pub default_output_dir: Option<String>,
    #[serde(default = "yes")]
    pub notify_native_on_failure: bool,
    #[serde(default)]
    pub max_parallel_runs: Option<u32>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SshAuthKind {
    Password,
    Key,
    Agent,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshJumpDescriptor {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuthKind,
    #[serde(default)]
    pub key_file: String,
    #[serde(default)]
    pub agent_socket: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SshDescriptor {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub auth: SshAuthKind,
    #[serde(default)]
    pub key_file: String,
    #[serde(default)]
    pub agent_socket: Option<String>,
    #[serde(default)]
    pub jump_hosts: Vec<SshJumpDescriptor>,
    #[serde(default)]
    pub remote_host: String,
    pub remote_port: u16,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProxyKind {
    Socks5,
    Http,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProxyDescriptor {
    #[serde(rename = "type")]
    pub kind: ProxyKind,
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AutomationConnection {
    pub id: String,
    pub name: String,
    pub kind: DatabaseKind,
    pub connection_string: String,
    #[serde(default)]
    pub read_only: bool,
    #[serde(default)]
    pub environment: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub ssh: Option<SshDescriptor>,
    #[serde(default)]
    pub proxy: Option<ProxyDescriptor>,
    #[serde(default)]
    pub vault: bool,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RunStatus {
    #[default]
    Running,
    Success,
    Warning,
    Failed,
    Cancelled,
    Timeout,
    Skipped,
    Interrupted,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TriggerKind {
    #[default]
    Manual,
    Schedule,
    AppStart,
    AfterTask,
    Cli,
    Background,
    RunTask,
    Rerun,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunSummary {
    pub id: String,
    pub task_id: String,
    pub task_name: String,
    pub trigger: TriggerKind,
    pub trigger_detail: Option<String>,
    pub status: RunStatus,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub duration_ms: Option<u64>,
    pub error: Option<String>,
    pub environment: Option<String>,
    pub rerun_of: Option<String>,
    pub parent_run_id: Option<String>,
    pub steps_total: u32,
    pub steps_done: u32,
    pub outputs: u32,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StepRun {
    pub seq: u32,
    pub step_id: String,
    pub step_name: String,
    pub kind: String,
    pub depth: u8,
    pub iteration: Option<u32>,
    pub attempt: u32,
    pub status: RunStatus,
    pub started_at: String,
    pub finished_at: Option<String>,
    pub duration_ms: Option<u64>,
    pub rows: Option<u64>,
    pub rows_affected: Option<u64>,
    pub message: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LogLine {
    pub seq: u32,
    pub at: String,
    pub level: LogLevel,
    pub step_id: Option<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunOutput {
    pub step_id: String,
    pub path: String,
    pub bytes: Option<u64>,
    pub format: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunDetail {
    pub summary: RunSummary,
    pub steps: Vec<StepRun>,
    pub logs: Vec<LogLine>,
    pub outputs: Vec<RunOutput>,
    pub vars: BTreeMap<String, String>,
    pub definition: Task,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskState {
    pub task_id: String,
    pub next_run_at: Option<String>,
    pub last_run_at: Option<String>,
    pub last_run_id: Option<String>,
    pub last_status: Option<RunStatus>,
    pub consecutive_failures: u32,
    pub disabled_reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskStats {
    pub runs: u32,
    pub success_rate: Option<f64>,
    pub average_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskSummary {
    pub task: Task,
    pub state: TaskState,
    pub running_run_id: Option<String>,
    pub stats: TaskStats,
    pub alerts: Vec<AlertState>,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AlertStatus {
    #[default]
    Unknown,
    Ok,
    Triggered,
    Error,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AlertState {
    pub task_id: String,
    pub step_id: String,
    pub status: AlertStatus,
    pub since: Option<String>,
    pub checked_at: Option<String>,
    pub last_notified_at: Option<String>,
    pub last_value: Option<String>,
    pub muted_until: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunFilter {
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub statuses: Vec<RunStatus>,
    #[serde(default)]
    pub triggers: Vec<TriggerKind>,
    #[serde(default)]
    pub from: Option<String>,
    #[serde(default)]
    pub to: Option<String>,
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationIssue {
    pub step_id: Option<String>,
    pub field: String,
    pub message: String,
    pub severity: Severity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImportReport {
    pub imported: Vec<String>,
    pub renamed: Vec<String>,
    pub needs_review: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskExportFile {
    pub format: u32,
    pub exported_at: String,
    pub app_version: String,
    pub tasks: Vec<Task>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundStatus {
    pub supported: bool,
    pub installed: bool,
    pub mechanism: String,
    pub location: Option<String>,
    pub binary: String,
    pub last_tick_at: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionCheck {
    pub ok: bool,
    pub via: String,
    pub message: String,
}
```

`TickReport` (in `scheduler.rs`, nicht serialisiert über IPC, aber im CLI per `--json` ausgegeben): `#[derive(Serialize)] #[serde(rename_all = "camelCase")] pub struct TickReport { pub app_running: bool, pub started: Vec<String>, pub skipped: Vec<String>, pub failed: Vec<String> }`. `AlertEvaluation` (in `alerts.rs`): `pub struct AlertEvaluation { pub status: AlertStatus, pub value: Option<String>, pub message: String }`.

`AutomationSettings` bekommt kein `derive(Default)` (die `yes`-Defaults gingen verloren); Standardwert ist `serde_json::from_value(serde_json::json!({}))`, gekapselt in `impl Default for AutomationSettings`.

Hinweis zu `Datagen.locale`: `crate::db::datagen::Locale` ist bereits `Serialize + Deserialize + Default` (`de`/`en`); `db::datagen` muss dafür `pub` erreichbar sein (ist es über `db::datagen`). `Backup.options`/`Restore.options` sind JSON im Format von `src/lib/db/backup.ts::BackupOptions` und werden zur Laufzeit in `db::backup::BackupOptions` deserialisiert.

Nicht erreichbar und bewusst nicht nötig: `db::connection` ist privat. `connection::forget` schließt daher nur den Tunnel (`services.ssh.close("automation:<id>")`); Pools zu entfernten Verbindungen laufen leer und werden mit dem Tunnel unbrauchbar. Den Default-Port liefert `db::provider::list_providers()` (`ProviderInfo { kind, default_port, .. }`), Dateibasiertheit `DatabaseKind::is_file_based()`.

### 6.2 TypeScript (`src/lib/db/automation.ts`, verbatim übernehmen)

```ts
import type { BackupOptions } from "./backup";
import type { DatabaseKind } from "./providers";

export type VariableKind = "text" | "number" | "boolean" | "date" | "choice" | "secret";
export type Backoff = "fixed" | "exponential";
export type MissedRunPolicy = "skip" | "run_once";
export type Comparator =
  | "eq"
  | "ne"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "contains"
  | "not_contains"
  | "matches"
  | "empty"
  | "not_empty";
export type IfExists = "overwrite" | "append" | "rename" | "fail";
export type ExportFormat =
  | "csv"
  | "tsv"
  | "json"
  | "jsonl"
  | "xlsx"
  | "xml"
  | "html"
  | "parquet"
  | "markdown"
  | "sql";
export type CopyModeConfig = "create" | "truncate" | "append";
export type ImportFileFormat = "csv" | "json" | "ndjson" | "xlsx" | "parquet";
export type Severity = "warning" | "error";
export type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
export type VarQueryMode = "first_value" | "row_count" | "column_list" | "json";
export type LogLevel = "debug" | "info" | "warn" | "error";
export type IntervalUnit = "minutes" | "hours" | "days";
export type AfterOutcome = "success" | "failure" | "always";
export type NotifyWhen =
  | "success"
  | "failure"
  | "always"
  | "warning"
  | "alert_triggered"
  | "alert_resolved";
export type SmtpSecurity = "starttls" | "tls" | "none";
export type WebhookKind = "slack" | "teams" | "discord" | "generic";
export type SshAuthKind = "password" | "key" | "agent";
export type ProxyKind = "socks5" | "http";
export type RunStatus =
  | "running"
  | "success"
  | "warning"
  | "failed"
  | "cancelled"
  | "timeout"
  | "skipped"
  | "interrupted";
export type TriggerKind =
  | "manual"
  | "schedule"
  | "app_start"
  | "after_task"
  | "cli"
  | "background"
  | "run_task"
  | "rerun";
export type AlertStatus = "unknown" | "ok" | "triggered" | "error";
export type DatagenLocale = "de" | "en";

export interface Environment {
  name: string;
  variables: Record<string, string>;
}

export interface Variable {
  name: string;
  kind: VariableKind;
  defaultValue: string;
  choices: string[];
  prompt: boolean;
  description: string;
}

export interface RetryPolicy {
  attempts: number;
  delaySeconds: number;
  backoff: Backoff;
  maxDelaySeconds: number | null;
}

export interface Retention {
  keepDays: number | null;
  keepRuns: number | null;
}

export type Flow =
  | { type: "next" }
  | { type: "goto"; stepId: string }
  | { type: "end_success" }
  | { type: "end_failure" };

export interface Cleanup {
  olderThanDays: number | null;
  keepLast: number | null;
}

export interface OutputSpec {
  path: string;
  appendTimestamp: boolean;
  ifExists: IfExists;
  zip: boolean;
  cleanup: Cleanup | null;
}

export interface CsvSettings {
  delimiter: string;
  quote: string;
  header: boolean;
  nullText: string;
  lineEnding: string;
  bom: boolean;
}

export type ExportSource =
  | { type: "query"; sql: string }
  | { type: "table"; schema: string; table: string; filter: string | null };

export interface SchemaPairConfig {
  source: string;
  target: string;
}

export interface TableCopyItem {
  schema: string;
  table: string;
  targetSchema: string;
  targetTable: string;
}

export interface ImportColumn {
  source: number;
  target: string;
}

export interface ImportConflict {
  constraint: string;
  updateColumns: string[];
}

export interface CompareSideConfig {
  connection: string;
  database: string | null;
  schema: string;
  table: string;
  filter: string | null;
}

export type CheckSpec =
  | {
      type: "row_count";
      schema: string | null;
      table: string | null;
      sql: string | null;
      op: Comparator;
      value: number;
    }
  | { type: "value"; sql: string; op: Comparator; value: string; tolerance: number | null }
  | { type: "not_null"; schema: string; table: string; column: string }
  | { type: "unique"; schema: string; table: string; columns: string[] }
  | { type: "accepted_values"; schema: string; table: string; column: string; values: string[] }
  | {
      type: "freshness";
      schema: string;
      table: string;
      column: string;
      warnAfterMinutes: number | null;
      errorAfterMinutes: number;
    }
  | { type: "query"; sql: string };

export type AlertCondition =
  | { type: "has_rows" }
  | { type: "no_rows" }
  | { type: "value"; column: string | null; op: Comparator; threshold: string }
  | { type: "error" };

export interface VarQuery {
  connection: string;
  database: string | null;
  sql: string;
  mode: VarQueryMode;
  separator: string | null;
}

export type LoopSource =
  | { type: "query"; connection: string; database: string | null; sql: string }
  | { type: "connections"; connections: string[]; tag: string | null }
  | { type: "list"; values: string }
  | { type: "files"; dir: string; pattern: string };

export type ChannelRef =
  | { type: "native" }
  | { type: "email"; profileId: string; to: string[]; cc: string[] }
  | { type: "webhook"; webhookId: string };

export type Action =
  | { type: "sql"; connections: string[]; database: string | null; sql: string; file: string | null }
  | {
      type: "export";
      connection: string;
      database: string | null;
      source: ExportSource;
      format: ExportFormat;
      output: OutputSpec;
      csv: CsvSettings | null;
      sheetName: string | null;
      maxRows: number | null;
    }
  | {
      type: "backup";
      connection: string;
      database: string | null;
      output: OutputSpec;
      options: Partial<BackupOptions>;
    }
  | {
      type: "restore";
      connection: string;
      database: string | null;
      path: string;
      options: Partial<BackupOptions>;
      allowProduction: boolean;
    }
  | {
      type: "transfer";
      source: string;
      sourceDatabase: string | null;
      target: string;
      targetDatabase: string | null;
      schemas: SchemaPairConfig[];
      foldNames: boolean;
    }
  | {
      type: "table_copy";
      source: string;
      sourceDatabase: string | null;
      target: string;
      targetDatabase: string | null;
      tables: TableCopyItem[];
      mode: CopyModeConfig;
      includePrimaryKey: boolean;
      includeIndexes: boolean;
    }
  | {
      type: "datagen";
      connection: string;
      database: string | null;
      schema: string;
      table: string;
      rows: number;
      seed: number | null;
      locale: DatagenLocale;
      transaction: boolean;
    }
  | {
      type: "import";
      connection: string;
      database: string | null;
      schema: string;
      table: string;
      file: string;
      format: ImportFileFormat;
      delimiter: string | null;
      hasHeader: boolean;
      sheet: string | null;
      columns: ImportColumn[];
      conflict: ImportConflict | null;
    }
  | {
      type: "compare";
      left: CompareSideConfig;
      right: CompareSideConfig;
      keyColumns: string[];
      compareColumns: string[];
      failIfDifferent: boolean;
      report: OutputSpec | null;
    }
  | {
      type: "check";
      connection: string;
      database: string | null;
      check: CheckSpec;
      severity: Severity;
    }
  | {
      type: "alert";
      connection: string;
      database: string | null;
      sql: string;
      condition: AlertCondition;
      rearmMinutes: number | null;
      notifyOnResolve: boolean;
    }
  | {
      type: "shell";
      program: string;
      args: string[];
      cwd: string | null;
      env: Record<string, string>;
      successCodes: number[];
      capture: string | null;
    }
  | {
      type: "http";
      method: HttpMethod;
      url: string;
      headers: Record<string, string>;
      body: string | null;
      expectStatus: string | null;
      capture: string | null;
    }
  | { type: "file_copy"; from: string; to: string; overwrite: boolean }
  | { type: "file_move"; from: string; to: string; overwrite: boolean }
  | { type: "file_delete"; path: string }
  | { type: "mkdir"; path: string }
  | { type: "file_exists"; path: string; failIfMissing: boolean; capture: string | null }
  | { type: "zip"; sources: string[]; output: OutputSpec }
  | { type: "unzip"; archive: string; target: string; overwrite: boolean }
  | { type: "cleanup"; dir: string; pattern: string; cleanup: Cleanup }
  | { type: "notify"; channel: ChannelRef; title: string; body: string; attachOutputs: boolean }
  | { type: "wait"; seconds: number | null; until: string | null }
  | { type: "set_variable"; name: string; value: string; query: VarQuery | null; calculate: boolean }
  | { type: "condition"; left: string; op: Comparator; right: string; then: Flow; otherwise: Flow }
  | {
      type: "loop";
      over: LoopSource;
      steps: Step[];
      item: string;
      maxIterations: number | null;
      continueOnError: boolean;
    }
  | {
      type: "run_task";
      task: string;
      wait: boolean;
      vars: Record<string, string>;
      environment: string | null;
    }
  | { type: "log"; level: LogLevel; message: string }
  | { type: "fail"; message: string };

export type ActionType = Action["type"];

export interface Step {
  id: string;
  name: string;
  enabled: boolean;
  action: Action;
  onSuccess: Flow;
  onFailure: Flow;
  retry: RetryPolicy | null;
  timeoutSeconds: number | null;
}

export type Trigger =
  | { type: "interval"; every: number; unit: IntervalUnit }
  | { type: "daily"; times: string[] }
  | { type: "weekly"; weekdays: number[]; times: string[] }
  | { type: "monthly"; days: number[]; lastDay: boolean; times: string[] }
  | { type: "monthly_nth"; nth: number; weekday: number; times: string[] }
  | { type: "cron"; expression: string }
  | { type: "once"; at: string }
  | { type: "app_start"; delaySeconds: number }
  | { type: "after_task"; taskId: string; on: AfterOutcome };

export interface TimeWindow {
  from: string;
  to: string;
}

export interface Schedule {
  id: string;
  enabled: boolean;
  trigger: Trigger;
  timezone: string | null;
  startAt: string | null;
  endAt: string | null;
  exclusions: string[];
  window: TimeWindow | null;
  vars: Record<string, string>;
  environment: string | null;
}

export interface NotificationRule {
  id: string;
  enabled: boolean;
  when: NotifyWhen;
  channel: ChannelRef;
  title: string;
  body: string;
  attachOutputs: boolean;
  skipIfEmpty: boolean;
}

export interface Task {
  id: string;
  name: string;
  description: string;
  folder: string;
  tags: string[];
  enabled: boolean;
  steps: Step[];
  schedules: Schedule[];
  variables: Variable[];
  environments: Environment[];
  defaultEnvironment: string | null;
  notifications: NotificationRule[];
  timeoutSeconds: number | null;
  retry: RetryPolicy | null;
  maxConsecutiveFailures: number | null;
  missedRuns: MissedRunPolicy;
  background: boolean;
  retention: Retention | null;
  needsReview: boolean;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface SmtpProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  security: SmtpSecurity;
  username: string | null;
  from: string;
  replyTo: string | null;
}

export interface WebhookTarget {
  id: string;
  name: string;
  kind: WebhookKind;
  headers: Record<string, string>;
  sign: boolean;
}

export interface AutomationSettings {
  schedulerEnabled: boolean;
  smtpProfiles: SmtpProfile[];
  webhooks: WebhookTarget[];
  defaultRetention: Retention | null;
  sshTrustNewHosts: boolean;
  backupToolPaths: Record<string, string>;
  defaultOutputDir: string | null;
  notifyNativeOnFailure: boolean;
  maxParallelRuns: number | null;
}

export interface SshJumpDescriptor {
  host: string;
  port: number;
  user: string;
  auth: SshAuthKind;
  keyFile: string;
  agentSocket: string | null;
}

export interface SshDescriptor {
  host: string;
  port: number;
  user: string;
  auth: SshAuthKind;
  keyFile: string;
  agentSocket: string | null;
  jumpHosts: SshJumpDescriptor[];
  remoteHost: string;
  remotePort: number;
}

export interface ProxyDescriptor {
  type: ProxyKind;
  host: string;
  port: number;
  username: string | null;
}

export interface AutomationConnection {
  id: string;
  name: string;
  kind: DatabaseKind;
  connectionString: string;
  readOnly: boolean;
  environment: string | null;
  tags: string[];
  ssh: SshDescriptor | null;
  proxy: ProxyDescriptor | null;
  vault: boolean;
}

export interface RunSummary {
  id: string;
  taskId: string;
  taskName: string;
  trigger: TriggerKind;
  triggerDetail: string | null;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
  environment: string | null;
  rerunOf: string | null;
  parentRunId: string | null;
  stepsTotal: number;
  stepsDone: number;
  outputs: number;
}

export interface StepRun {
  seq: number;
  stepId: string;
  stepName: string;
  kind: string;
  depth: number;
  iteration: number | null;
  attempt: number;
  status: RunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  rows: number | null;
  rowsAffected: number | null;
  message: string | null;
  error: string | null;
}

export interface LogLine {
  seq: number;
  at: string;
  level: LogLevel;
  stepId: string | null;
  message: string;
}

export interface RunOutput {
  stepId: string;
  path: string;
  bytes: number | null;
  format: string;
}

export interface RunDetail {
  summary: RunSummary;
  steps: StepRun[];
  logs: LogLine[];
  outputs: RunOutput[];
  vars: Record<string, string>;
  definition: Task;
}

export interface TaskState {
  taskId: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunId: string | null;
  lastStatus: RunStatus | null;
  consecutiveFailures: number;
  disabledReason: string | null;
}

export interface TaskStats {
  runs: number;
  successRate: number | null;
  averageMs: number | null;
}

export interface AlertState {
  taskId: string;
  stepId: string;
  status: AlertStatus;
  since: string | null;
  checkedAt: string | null;
  lastNotifiedAt: string | null;
  lastValue: string | null;
  mutedUntil: string | null;
}

export interface TaskSummary {
  task: Task;
  state: TaskState;
  runningRunId: string | null;
  stats: TaskStats;
  alerts: AlertState[];
}

export interface RunFilter {
  taskId?: string | null;
  statuses?: RunStatus[];
  triggers?: TriggerKind[];
  from?: string | null;
  to?: string | null;
  text?: string | null;
  limit?: number | null;
  offset?: number | null;
}

export interface ValidationIssue {
  stepId: string | null;
  field: string;
  message: string;
  severity: Severity;
}

export interface ImportReport {
  imported: string[];
  renamed: string[];
  needsReview: string[];
}

export interface BackgroundStatus {
  supported: boolean;
  installed: boolean;
  mechanism: string;
  location: string | null;
  binary: string;
  lastTickAt: string | null;
  detail: string | null;
}

export interface ConnectionCheck {
  ok: boolean;
  via: string;
  message: string;
}

export interface RunTaskInput {
  taskId: string;
  vars?: Record<string, string>;
  environment?: string | null;
  fromStep?: string | null;
  rerunOf?: string | null;
  useOriginalDefinition?: boolean;
}

export type AutomationEvent =
  | { event: "run_started"; run: RunSummary }
  | { event: "run_step"; runId: string; taskId: string; step: StepRun }
  | { event: "run_log"; runId: string; line: LogLine }
  | { event: "run_finished"; run: RunSummary }
  | { event: "tasks_changed"; ids: string[] }
  | { event: "alert_changed"; alert: AlertState };
```

Serde-Hinweis: `Option<T>`-Felder ohne `skip_serializing_if` werden als `null` gesendet; das Frontend sendet ebenfalls `null` statt Feld weglassen (alle `default`-Annotationen erlauben trotzdem Weglassen, wichtig für Import alter Dateien).

---

## 7. Tauri-Commands, Events, TS-Wrapper

Alle Commands in `src-tauri/src/automation/mod.rs`, registriert in `lib.rs` (`automation::automation_*`). Fehler immer `Result<_, String>` mit deutschem Text. `services` kommt aus `tauri::State<'_, AutomationState>`; ist es noch nicht initialisiert → `Err("Automatisierung wird gestartet. Bitte gleich erneut versuchen.")`.

| Command | Argumente (JS-Namen) | Rückgabe | Verhalten |
|---|---|---|---|
| `automation_sync_connections` | `connections: AutomationConnection[]` | `void` | Ersetzt Tabelle `connections` (nur bei geändertem Hash), ruft `connection::forget` für entfallene oder geänderte Einträge |
| `automation_list_tasks` | – | `TaskSummary[]` | sortiert nach `folder`, `name` |
| `automation_get_task` | `id: string` | `Task` | |
| `automation_save_task` | `task: Task, expectedRevision: number \| null` | `TaskSummary` | validiert (`engine::validate` – Fehler-Issues blockieren das Speichern nicht, nur Aktivieren), setzt `updatedAt`, `createdAt` bei neu, `needsReview = false`, Revision +1; ruft `scheduler::reschedule`; Event `tasks_changed` |
| `automation_delete_tasks` | `ids: string[]` | `void` | löscht Tasks, State, Alarme, Leases; Läufe bleiben in der Historie; löscht `automation:var:<taskId>:*`-Secrets **nicht** selbst (macht das Frontend über `deleteSecret`, da Liste der geheimen Variablen bekannt) |
| `automation_duplicate_task` | `id: string` | `TaskSummary` | neue IDs für Task, Schritte, Zeitpläne, Benachrichtigungen; Name „<Name> (Kopie)“, bei Kollision „(Kopie 2)“ …; `enabled = false` |
| `automation_set_enabled` | `ids: string[], enabled: boolean` | `TaskSummary[]` | Aktivieren schlägt fehl, wenn `needsReview` oder Fehler-Issues: `„<Name>“ hat ungelöste Fehler: <erste Meldung>`; setzt `consecutive_failures = 0`, `disabled_reason = null` |
| `automation_validate_task` | `task: Task` | `ValidationIssue[]` | |
| `automation_export_tasks` | `ids: string[], path: string` | `number` | schreibt `TaskExportFile` (Format 1), Werte geheimer Variablen nie enthalten (sie liegen ohnehin nur im Schlüsselbund) |
| `automation_import_tasks` | `path: string` | `ImportReport` | akzeptiert `TaskExportFile` oder einzelnen `Task`; neue IDs, Namenskollision → „<Name> (importiert)“; Tasks mit `shell`, `http`, `file_delete`, `cleanup`, `restore`, `run_task`, `notify` (Webhook/E-Mail) oder Zeitplänen werden mit `enabled = false, needsReview = true` angelegt |
| `automation_run_task` | `input: RunTaskInput` | `string` (runId) | `engine::start` mit `TriggerKind::Manual` bzw. `Rerun` (wenn `rerunOf`); `StartError` → deutsche Meldung |
| `automation_cancel_run` | `runId: string` | `boolean` | |
| `automation_list_runs` | `filter: RunFilter` | `RunSummary[]` | Standard-Limit 200, max. 1 000 |
| `automation_get_run` | `runId: string` | `RunDetail` | |
| `automation_delete_runs` | `ids: string[]` | `number` | laufende Läufe werden ausgelassen |
| `automation_export_runs` | `filter: RunFilter, format: "json" \| "csv", path: string` | `number` | JSON = `RunDetail[]` ohne `definition`; CSV = eine Zeile pro Lauf (`id;task;status;trigger;startedAt;finishedAt;durationMs;error`) |
| `automation_preview_schedule` | `schedule: Schedule, count: number` | `string[]` | `schedule::next_runs` ab jetzt, `count ≤ 20`; Fehler bei ungültigem Zeitplan (z. B. `Ungültiger Cron-Ausdruck: …`) |
| `automation_next_runs` | `hours: number` | `{ taskId: string; at: string }[]` | Vorschau aller aktiven Tasks für die nächsten `hours` (≤ 168) – für die Planungsübersicht |
| `automation_get_settings` | – | `AutomationSettings` | |
| `automation_save_settings` | `settings: AutomationSettings` | `AutomationSettings` | |
| `automation_test_channel` | `channel: ChannelRef` | `void` | sendet „Testnachricht von l8db“ |
| `automation_test_connection` | `connection: string` | `ConnectionCheck` | `connection::resolve` + `test_connection`, `via` = „direkt“ / „SSH-Tunnel“ / „Proxy“ |
| `automation_set_alert_mute` | `taskId: string, stepId: string, until: string \| null` | `AlertState` | |
| `automation_background_status` | – | `BackgroundStatus` | |
| `automation_install_background` | – | `BackgroundStatus` | |
| `automation_uninstall_background` | – | `BackgroundStatus` | |
| `automation_cli_command` | `taskId: string` | `string` | `os_scheduler::command_line` mit absolutem Binärpfad, korrekt gequotet für die Plattform |

Event: genau ein Kanal **`automation-event`** mit Payload `AutomationEvent` (getaggt über `event`). `run_log` wird höchstens alle 250 ms gebündelt (mehrere Events in Folge erlaubt, aber nie mehr als 20 pro Sekunde und Lauf). Kein weiteres Event.

TS-Wrapper `src/lib/db/automation.ts` (zusätzlich zu den Typen aus 6.2; `invoke` aus `./core`; in `src/lib/db/index.ts` per `export * from "./automation";` exportieren):

```ts
export const syncAutomationConnections = (connections: AutomationConnection[]) =>
  invoke<void>("automation_sync_connections", { connections });
export const listAutomationTasks = () => invoke<TaskSummary[]>("automation_list_tasks");
export const getAutomationTask = (id: string) => invoke<Task>("automation_get_task", { id });
export const saveAutomationTask = (task: Task, expectedRevision: number | null) =>
  invoke<TaskSummary>("automation_save_task", { task, expectedRevision });
export const deleteAutomationTasks = (ids: string[]) => invoke<void>("automation_delete_tasks", { ids });
export const duplicateAutomationTask = (id: string) =>
  invoke<TaskSummary>("automation_duplicate_task", { id });
export const setAutomationTasksEnabled = (ids: string[], enabled: boolean) =>
  invoke<TaskSummary[]>("automation_set_enabled", { ids, enabled });
export const validateAutomationTask = (task: Task) =>
  invoke<ValidationIssue[]>("automation_validate_task", { task });
export const exportAutomationTasks = (ids: string[], path: string) =>
  invoke<number>("automation_export_tasks", { ids, path });
export const importAutomationTasks = (path: string) =>
  invoke<ImportReport>("automation_import_tasks", { path });
export const runAutomationTask = (input: RunTaskInput) =>
  invoke<string>("automation_run_task", { input });
export const cancelAutomationRun = (runId: string) =>
  invoke<boolean>("automation_cancel_run", { runId });
export const listAutomationRuns = (filter: RunFilter) =>
  invoke<RunSummary[]>("automation_list_runs", { filter });
export const getAutomationRun = (runId: string) => invoke<RunDetail>("automation_get_run", { runId });
export const deleteAutomationRuns = (ids: string[]) =>
  invoke<number>("automation_delete_runs", { ids });
export const exportAutomationRuns = (filter: RunFilter, format: "json" | "csv", path: string) =>
  invoke<number>("automation_export_runs", { filter, format, path });
export const previewAutomationSchedule = (schedule: Schedule, count = 5) =>
  invoke<string[]>("automation_preview_schedule", { schedule, count });
export const automationNextRuns = (hours: number) =>
  invoke<{ taskId: string; at: string }[]>("automation_next_runs", { hours });
export const getAutomationSettings = () => invoke<AutomationSettings>("automation_get_settings");
export const saveAutomationSettings = (settings: AutomationSettings) =>
  invoke<AutomationSettings>("automation_save_settings", { settings });
export const testAutomationChannel = (channel: ChannelRef) =>
  invoke<void>("automation_test_channel", { channel });
export const testAutomationConnection = (connection: string) =>
  invoke<ConnectionCheck>("automation_test_connection", { connection });
export const setAutomationAlertMute = (taskId: string, stepId: string, until: string | null) =>
  invoke<AlertState>("automation_set_alert_mute", { taskId, stepId, until });
export const automationBackgroundStatus = () =>
  invoke<BackgroundStatus>("automation_background_status");
export const installAutomationBackground = () =>
  invoke<BackgroundStatus>("automation_install_background");
export const uninstallAutomationBackground = () =>
  invoke<BackgroundStatus>("automation_uninstall_background");
export const automationCliCommand = (taskId: string) =>
  invoke<string>("automation_cli_command", { taskId });
export const onAutomationEvent = (handler: (event: AutomationEvent) => void) =>
  listen<AutomationEvent>("automation-event", ({ payload }) => handler(payload));
```

`listen` kommt aus `@tauri-apps/api/event` (wie in `src/lib/db/core.ts`), `invoke` aus `./core` (`export async function invoke<T>(command, args?)`, verifiziert).

---

## 8. Laufzeit-Semantik

### 8.1 Lauf-Lebenszyklus (`engine.rs`)

1. Task laden (bzw. Definition aus `rerun_of` bei `use_original_definition`). Prüfungen in dieser Reihenfolge: nicht gefunden → `NotFound`; `needs_review` → `NeedsReview`; `enabled == false` und Trigger ∉ {`Manual`, `Cli`, `Rerun`} → `Disabled` (manuelle Läufe deaktivierter Tasks sind erlaubt); Fehler-Issues aus `validate` → `Invalid(erste Meldung)`; `depth > 5` → `Invalid("Zu tiefe Verschachtelung von Tasks (max. 5).")`.
2. Lease nehmen (Abschnitt 5) → sonst `AlreadyRunning`. `max_parallel_runs` (Standard 4) gilt pro Prozess über einen `tokio::sync::Semaphore`; wartende Läufe bleiben `running` mit Logzeile `Wartet auf freien Ausführungsplatz.`
3. Lauf-Zeile anlegen (`status = running`, `definition_json`, `vars_json` maskiert, `pid`), Event `run_started`.
4. `Vars::new` mit: Umgebung = `request.environment` → `schedule.environment` (vom Scheduler in `request` gesetzt) → `task.default_environment`; Overrides = Zeitplan-`vars` < Prompt/CLI-`vars`; geheime Variablen aus dem Schlüsselbund (`automation:var:<taskId>:<env>:<name>`, Fallback `automation:var:<taskId>:<name>`). Fehlende Pflicht-Variable (kein Default, kein Override, `kind != boolean`) → Lauf `failed`, Meldung `Variable „x“ hat keinen Wert.`
5. Schritte ausführen ab `from_step` (Index der Step-ID auf oberster Ebene, sonst erster Schritt). Programmzähler über die Liste der obersten Ebene; `Flow::Goto` springt nur innerhalb derselben Ebene (Validierung prüft das). Endlosschleifen-Schutz: max. 10 000 Schritt-Ausführungen pro Lauf → `failed` mit `Abbruch: mehr als 10 000 Schrittausführungen.`
6. Deaktivierte Schritte (`enabled = false`) erzeugen einen `StepRun` mit `skipped` und laufen mit `on_success` weiter.
7. Pro Schritt: `job_id = "automation:<runId>:<stepId>:<attempt>"`; Ausführung innerhalb `db::execution::run(Some(ExecutionOptions{ job_id, query_timeout: step.timeout_seconds, connection_timeout: None }), true, …)` und zusätzlich `tokio::time::timeout(step.timeout_seconds)`; Timeout → Schrittstatus `timeout`, behandelt wie Fehler (Retry gilt).
8. Retry: Policy = `step.retry` sonst `task.retry` sonst keiner. Versuche `1 + attempts`. Pause `delay_seconds`, exponentiell `delay * 2^(n-1)`, gedeckelt durch `max_delay_seconds` (Standard 3 600). Jeder Versuch ist ein eigener `StepRun` (`attempt` 1, 2, …). Abbruch während der Pause beendet sofort. Kein Retry bei `fail`-, `condition`- und Validierungsfehlern.
9. Ergebnis: Erfolg → `vars.set_step`, `outcome.vars` übernehmen, Flow = `outcome.flow` (Bedingung) sonst `on_success`. Fehler (nach letztem Versuch) → `on_failure`. Warnung (`outcome.warning`) zählt als Erfolg, setzt aber den Laufstatus am Ende auf `warning` (sofern nicht `failed`).
10. Ende: `EndSuccess` → `success`/`warning`; `EndFailure` oder Fehler mit `on_failure = end_failure` → `failed`; Abbruch → `cancelled`; Task-Timeout (`task.timeout_seconds`, umfasst alles inkl. Retry-Pausen) → `timeout`; `Next` hinter dem letzten Schritt → Erfolg. `error` des Laufs = erste unbehandelte Fehlermeldung bzw. `Fail.message`.
11. Abschluss in dieser Reihenfolge: Lauf-Zeile aktualisieren → `task_state` (`last_*`, `consecutive_failures` +1 bei `failed`/`timeout`, sonst 0) → Auto-Deaktivierung: wenn `max_consecutive_failures` erreicht → `enabled = false`, `disabled_reason = "Nach N Fehlern in Folge automatisch deaktiviert."`, Event `tasks_changed` → `notify::dispatch` (Abschnitt 8.6) → Retention → Lease löschen → Event `run_finished` → `scheduler::on_run_finished`.
12. Abbruch (`cancel(run_id)`): setzt das `CancellationToken` des Laufs und ruft `db::execution::cancel(job_id)` für den aktiven Schritt; laufende Shell-Prozesse werden beendet (`Child::kill`), HTTP-Futures fallen weg.
13. Task-Center-Abbildung macht das Frontend aus Events (Abschnitt 9.4); die Engine kennt das Task-Center nicht.
14. Headless (`services.headless`): `sink` schreibt `run_step`/`run_log` als Textzeilen nach stderr (`[HH:MM:SS] Schritt 2/5 „Export“ erfolgreich (1 234 Zeilen, 0,8 s)`), es sei denn `--json` (dann still bis zum Endbericht).

### 8.2 Variablen und Platzhalter (`vars.rs`)

Syntax: `${name}`, `${name:-default}`, `${name|filter}`, `${name:-default|filter}`; literales `${` per `$${`. Unbekannte Variable ohne Default → Fehler `Unbekannte Variable „name“.` (Fehler des Schritts). Namen: `[A-Za-z_][A-Za-z0-9_.-]*`.

Eingebaut (nicht überschreibbar, Werte in der Zeitzone des auslösenden Zeitplans bzw. Systemzeit):

| Variable | Wert |
|---|---|
| `${date}` | `YYYY-MM-DD` |
| `${time}` | `HH-mm-ss` (dateinamensicher) |
| `${timestamp}` | `YYYYMMDD-HHmmss` |
| `${date:FORMAT}` | chrono-`strftime`, z. B. `${date:%Y/%m}` |
| `${date-1d}`, `${date+2h:%H}` | relativ, Einheiten `s m h d w M y` |
| `${now}` | RFC 3339 UTC |
| `${task}`, `${task_id}`, `${run_id}`, `${trigger}`, `${environment}` | Lauf-Metadaten |
| `${connection}`, `${connection_id}`, `${database}`, `${host}` | der zuletzt aufgelöste Verbindung des aktuellen Schritts (`set_connection`) |
| `${user}`, `${hostname}`, `${home}`, `${output_dir}` | Betriebssystem bzw. `settings.default_output_dir` |
| `${step.N.rows}`, `${step.N.rows_affected}`, `${step.N.value}`, `${step.N.status}`, `${step.N.error}`, `${step.N.output}`, `${step.N.duration_ms}` | `N` = 1-basierte Position auf oberster Ebene **oder** Step-ID |
| `${last.*}` | dieselben Felder für den zuletzt ausgeführten Schritt; `${last.error}` ist leer, wenn kein Fehler |
| `${run.status}`, `${run.duration}`, `${run.error}`, `${run.outputs}` (Zeilenliste), `${run.summary}` (Text-Tabelle der Schritte) | nur in Benachrichtigungen und nach Laufende |
| `${item}`, `${item.<spalte>}`, `${item.index}` | Schleifen (Präfix = `Loop.item`) |
| `${alert.status}`, `${alert.value}`, `${alert.since}` | Alarm-Schritte und -Benachrichtigungen |

Filter: `sql` (verdoppelt `'`; für `mysql`/`clickhouse` zusätzlich `\` → `\\`; nur in `render_sql` mit `kind` des Schritts), `json` (JSON-String-Literal ohne äußere Anführungszeichen), `url` (Prozent-Kodierung), `upper`, `lower`, `trim`, `filename` (ersetzt `/\:*?"<>|` durch `_`).

SQL-Sicherheit: Platzhalter in SQL sind Textersetzung. Der Editor zeigt bei `${item.*}`/`${step.*}` in SQL ohne `|sql` eine Warnung („Wert wird ungeprüft eingesetzt. Nutze |sql in String-Literalen.“). Kein automatisches Escaping, weil Platzhalter auch Bezeichner oder ganze Fragmente sein dürfen.

Maskierung: Werte aller `secret`-Variablen (Länge ≥ 4) werden in Logs, Fehlern, `vars_json`, Benachrichtigungstexten an Dritte (nicht in HTTP-Headern/Bodies, dort werden sie gebraucht) und CLI-Ausgaben durch `••••` ersetzt (`Vars::mask`).

Rechnen (`SetVariable.calculate`): nach dem Rendern Auswertung von `+ - * / %`, Klammern, Dezimalzahlen; Ergebnis ohne `.0` bei Ganzzahlen (`calculate("1+2*3") == 7`). Vergleich (`compare`): wenn beide Seiten als `f64` parsebar → numerisch, sonst Text; `matches` = Regex (`regex`-Crate, vorhanden); `empty` ignoriert rechte Seite.

### 8.3 Schritte im Detail

Alle Pfade werden gerendert, `~` expandiert, relative Pfade gegen `settings.default_output_dir` (fehlt er → Fehler `Relativer Pfad ohne Standard-Ausgabeordner.`).

| Typ | Verhalten | Ergebnis |
|---|---|---|
| `sql` | Für jede Verbindung in `connections` (Reihenfolge): SQL = `file` (gelesen, gerendert) sonst `sql` (gerendert mit `render_sql`). Schreibende Statements auf `read_only`-Verbindungen lässt der Server ablehnen (Read-Only-Option steckt in der URL). Ausführung `adapter.execute_script`; besteht das Skript aus genau einem Statement (`db::sql_script::split`), stattdessen `execute_query`, damit Zeilen verfügbar sind. Fehler in einer Verbindung → Schrittfehler mit Verbindungsname. | `rows` = Zeilen des letzten Statements, `rows_affected` = Summe, `value` = erste Zelle |
| `export` | `query`: `execute_query`, Abbruch bei mehr als `max_rows` (Standard und Obergrenze 1 000 000) mit `Ergebnis hat mehr als N Zeilen. Nutze Tabellenexport.`; Schreiben je Format: CSV/TSV über `export::CsvFileWriter` + `csv_row_line` (TSV = Delimiter `\t`), XML/HTML/Parquet über `export_formats::RowSink`, JSON (Array von Objekten, pretty), JSONL, Markdown (wie `serializeRows` in `src/lib/export.ts`), SQL-INSERT (Port von `buildInsertStatements` für Dialekte aus `db::import::Dialect`, Ziel = `sheet_name` oder `export`), XLSX über `steps/xlsx.rs` (Blattname `sheet_name` oder „Daten“, max. 1 048 576 Zeilen). `table`: wenn `kind.capabilities().full_table_export` und Format ∈ {csv, tsv, xml, html, parquet} → `adapter.export_table_csv` (Streaming, `TableExportRequest{ job_id, schema, table, filter, allow_raw_filter: true, … }`), sonst wie `query` mit `SELECT * FROM <quoted>`. `if_exists = append` nur für csv/tsv/jsonl/markdown/sql, sonst Validierungsfehler. | `rows`, `outputs` |
| `backup` | `backup::backup(kind, url, database, &BackupRequest{ path: target_path(..), options: serde_json::from_value(options), tool_paths: settings.backup_tool_paths }, emit, Some(job_id), pool)`; `emit` schreibt Fortschritt als Debug-Log | `outputs` (Pfad, Bytes) |
| `restore` | Gesperrt, wenn `resolved.read_only` (`Lesemodus: Wiederherstellung ist für diese Verbindung gesperrt.`) oder `environment == "production"` ohne `allow_production`; sonst `backup::restore(...)` | `message` = Log-Ende |
| `transfer` | `transfer::plan(&target, &PlanRequest{ source, schemas, fold_names }, pool)` → wenn `plan.conflicts` nicht leer → Fehler `Zieltabellen existieren bereits: …` → `transfer::run(&target, &RunRequest{ source, plan }, pool, &progress)`; `outcome.error` → Fehler | `rows`, `message` (Tabellen) |
| `table_copy` | Pro Eintrag `table_copy::copy_table(target_kind, target_url, target_db, pool, &TableCopyRequest{ source: CopySource{…}, target_schema, target_table, mode, include_primary_key, include_indexes, dry_run: false })`; `outcome.error` → Fehler; Warnungen → Log `warn` | `rows` = Summe |
| `datagen` | `datagen::plan(adapter, kind, schema, table)` → `DatagenRequest{ schema, table, rows, batch_size: 500, seed: seed.unwrap_or(zufällig), locale, transaction, columns: plan.columns, unique: plan.unique, source: None }` → `datagen::run(adapter, kind, url, scoped_database(..), &request, &pool, &transactions)`; Read-only → Fehler wie `datagen_run` | `rows_affected` = `inserted` |
| `import` | `adapter.csv_import(&CsvImportRequest{ file: Some(CsvFileSource{ path, delimiter (Standard `,`), quote: "\"", has_header, empty_as_null: true, indices: columns.source, format, sheet, skip_rows: 0, keys: vec![] }), conflict, schema, table, columns: columns.target, rows: vec![] })`; `kind.capabilities().csv_import` muss gelten; `failed_row` → Fehler `Zeile N, Spalte X: …` | `rows_affected` = inserted + updated |
| `compare` | `data_compare::compare(&CompareRequest{ left: CompareSide{ connection_string, database, kind: Some(kind), source: SnapshotRequest{ schema, table, filter, allow_raw_filter: true, order_by: None, order_desc: false, is_view: false, max_rows: 1_000_000 } }, right, key_columns, compare_columns }, &pool)`; `report` → JSON-Datei mit `counts` und `rows`; `fail_if_different` und Unterschiede → Fehler `Daten unterscheiden sich: X nur links, Y nur rechts, Z geändert.` | `value` = `{onlyLeft, onlyRight, changed, equal}`, `rows` = Unterschiede |
| `check` | SQL je Prüfung (Bezeichner via `Dialect::quote`, ohne Dialekt → Fehler „Prüfung für diesen Datenbanktyp nicht verfügbar.“): `row_count` → `SELECT COUNT(*) FROM t` bzw. `SELECT COUNT(*) FROM (<sql>) q`; `not_null` → `… WHERE col IS NULL`; `unique` → `SELECT COUNT(*) FROM (SELECT cols FROM t GROUP BY cols HAVING COUNT(*) > 1) d`; `accepted_values` → `… WHERE col IS NOT NULL AND col NOT IN (<Literale>)` (Literale `'…'` mit `|sql`-Escaping); `freshness` → `SELECT MAX(col) FROM t`, Vergleich in Rust (Zeitstempel parsen, ohne Zone = UTC); `query` → Verstoß, wenn Zeilen; `value` → erste Zelle vs. `value` mit `tolerance` (\|a−b\| ≤ tol gilt als gleich). Verstoß bei `severity = warning` → `outcome.warning`, sonst Fehler. Meldung nennt Ist- und Sollwert. | `value` = Ist-Wert |
| `alert` | `execute_query(sql)` (Fehler wird nicht geworfen, sondern ausgewertet) → `alerts::evaluate` → `alerts::transition` mit gespeichertem `AlertState` → speichern, Event `alert_changed`; Rückgabe-Notify-Ereignis wird an `notify::dispatch` übergeben (außer `muted_until > now`). Der Schritt selbst ist erfolgreich, auch wenn der Alarm auslöst; `${alert.status}` ist danach gesetzt. CLI-Exit 10, wenn am Laufende ein Alarm-Schritt `triggered` ist. | `value` = Messwert, `alert` |
| `shell` | `tokio::process::Command::new(program).args(rendered args)`, kein Shell-Interpreter (Nutzer schreibt `sh -c …` selbst), `cwd`, `env` (zusätzlich `L8DB_RUN_ID`, `L8DB_TASK`), stdout/stderr je max. 1 MiB ins Log; Exit-Code ∉ `success_codes` → Fehler `Programm endete mit Code N.`; `capture` → stdout (getrimmt) in Variable | `value` = Exit-Code |
| `http` | `reqwest` (Client wie `warehouse_auth::http()` – Timeout aus Schritt, Standard 30 s), Methode, gerenderte URL/Header/Body; `expect_status` (`200`, `200-299`, `200,204`; Standard `200-299`); `capture` → Body (max. 1 MiB) | `value` = Statuscode |
| `file_copy`/`file_move` | Wildcards nur im letzten Pfadsegment von `from` (`*`, `?`); Ziel ist Ordner, wenn mehrere Treffer oder `to` mit `/` endet; existiert Ziel und `!overwrite` → Fehler; `move` über `rename`, bei `EXDEV` copy+delete | `rows` = Anzahl Dateien |
| `file_delete` | Wildcards wie oben; nur Dateien, keine Ordner; 0 Treffer ist kein Fehler (Log `info`) | `rows` |
| `mkdir` | `create_dir_all` | – |
| `file_exists` | Wildcards erlaubt; fehlt und `fail_if_missing` → Fehler; `capture` → `"true"`/`"false"` | `value` |
| `zip` | Quellen (Wildcards) → ZIP über `zip`-Crate (Deflate), Zielpfad per `OutputSpec` | `outputs` |
| `unzip` | `zip::ZipArchive`, Pfade mit `..` oder absolut werden abgelehnt (Zip-Slip) | `rows` |
| `cleanup` | in `dir` Dateien mit `pattern`: zuerst alle älter als `older_than_days` löschen, dann nach mtime absteigend die ersten `keep_last` behalten | `rows` = gelöscht |
| `notify` | `notify::send` mit gerendertem Titel/Text; `attach_outputs` hängt bisherige Ausgaben des Laufs an | – |
| `wait` | `seconds` oder bis Uhrzeit `until` (`HH:MM`, heute, sonst morgen), abbrechbar, max. 24 h | – |
| `set_variable` | `query` → Wert je `mode` (`first_value`, `row_count`, `column_list` mit `separator` Standard `,`, `json` = Zeilen als JSON); sonst `render(value)`; `calculate` → `vars::calculate` | `vars` |
| `condition` | `compare(render(left), op, render(right))` → `flow = then/otherwise` | `value` = `true`/`false` |
| `loop` | Quelle auswerten (Query: max. 10 000 Zeilen; Connections: IDs oder alle mit Tag; List: Zeilen bzw. Kommas; Files: Wildcard-Treffer sortiert); pro Element Variablen `${item…}` setzen und die verschachtelten Schritte wie eine eigene Ebene ausführen (eigener Programmzähler, `depth + 1`, `iteration`); Fehler eines Elements beendet die Schleife mit Fehler, außer `continue_on_error`; `max_iterations` Standard 10 000 | `rows` = Iterationen |
| `run_task` | Zyklus-Prüfung (Task-ID im Aufrufpfad) → `engine::execute` (bei `wait`) bzw. `engine::start` mit `TriggerKind::RunTask`, `parent_run_id`, `depth + 1`; Fehlstatus des Kind-Laufs → Fehler | `value` = Kind-`runId` |
| `log` | Logzeile mit Level | – |
| `fail` | Fehler mit gerenderter Meldung, kein Retry | – |

### 8.4 Ausgaben (`steps/output.rs`)

1. `path` rendern; fehlt die Endung, wird die Format-Endung angehängt.
2. `append_timestamp` → `-<timestamp>` vor der Endung (`bericht-20261004-073000.csv`).
3. Elternordner anlegen.
4. Kollision: `overwrite` → ersetzen (über temporäre Datei + `rename`, siehe `export_formats::AtomicFile`); `append` → anhängen (Header nur, wenn Datei neu); `rename` → `name (2).ext`, `name (3).ext` …; `fail` → Fehler `Datei existiert bereits: …`.
5. `zip` → `<datei>.zip` mit einer Datei, Original löschen.
6. `cleanup` → im Zielordner Dateien mit demselben Muster (gerenderter Name, in dem Zeitstempel-/Datumsplatzhalter durch `*` ersetzt sind) aufräumen wie beim `cleanup`-Schritt; die gerade geschriebene Datei bleibt immer erhalten.
7. `RunOutput { step_id, path, bytes, format }` zurückgeben.

### 8.5 XLSX in Rust (`steps/xlsx.rs`)

Port von `src/lib/xlsx.ts` (Inline-Strings, Zahlen als `n`, Kopfzeile fett, `XLSX_MAX_ROWS = 1_048_576`, `XLSX_MAX_COLUMNS = 16_384`, Blattname max. 31 Zeichen, gleiche Prüfungen wie `sheetNameError`). Schreiben über `zip::ZipWriter` (Deflate). Test: erzeugte Datei mit `calamine` (vorhanden) zurücklesen.

### 8.6 Benachrichtigungen (`notify.rs`)

`dispatch(services, task, run, event)`: für jede aktive Regel mit passendem `when` (`always` passt auf `success`, `warning` und `failure`; `warning` passt auch auf `success`-Regeln nicht) → Titel/Text rendern (Standardtexte unten), `skip_if_empty` überspringt, wenn der Lauf keine Ausgaben hat und keine Zeilen (`rows`) lieferte; `attach_outputs` hängt `run.outputs` an (E-Mail: als Anhänge, max. 20 MiB gesamt, darüber nur Pfade im Text; Webhook/System: nur Pfade). Zusätzlich, wenn `settings.notify_native_on_failure` und der Lauf **nicht manuell** gestartet wurde und keine eigene Native-Regel existiert: Systembenachrichtigung bei `failed`/`timeout`. Fehler beim Senden landen als `warn`-Logzeile im Lauf, ändern den Laufstatus nicht. Benachrichtigungen laufen erst nach dem letzten Retry (sie hängen am Laufende).

Standardtexte (wenn `title`/`body` leer):
- Titel Erfolg: `✓ ${task} erfolgreich` · Fehler: `✕ ${task} fehlgeschlagen` · Warnung: `! ${task} mit Warnungen` · Alarm: `Alarm: ${task}` · Entwarnung: `Entwarnung: ${task}`
- Text: `${run.summary}` plus bei Fehler `Fehler: ${run.error}`.

Kanäle:
- **System:** `notify_rust::Notification::new().summary(title).body(body).appname("l8db").show()`; macOS zusätzlich einmalig `notify_rust::set_application("com.leon.l8db")` (Fehler ignorieren). Läuft im Hintergrund-Tick genauso.
- **E-Mail:** `lettre::AsyncSmtpTransport::<Tokio1Executor>`: `starttls_relay`/`relay`/`builder_dangerous` je `security`, Port aus Profil, Credentials `username` + Schlüsselbund `automation:smtp:<id>`; `Message` mit `from`, `reply_to`, `to`, `cc`, Text-Body (`text/plain; charset=utf-8`), Anhänge per `MultiPart::mixed` + `Attachment::new(filename).body(bytes, mime_guess)`; Timeout 30 s.
- **Webhook:** URL aus Schlüsselbund `automation:webhook:<id>` (fehlt → Fehler `Webhook-URL fehlt im Schlüsselbund.`), POST JSON, Header aus `headers` (gerendert). Body je Art: Slack `{"text": "*<title>*\n<body>"}`; Discord `{"content": "**<title>**\n<body>"}` (auf 2 000 Zeichen gekürzt); Teams Adaptive Card `{"type":"message","attachments":[{"contentType":"application/vnd.microsoft.card.adaptive","content":{"type":"AdaptiveCard","version":"1.4","$schema":"http://adaptivecards.io/schemas/adaptive-card.json","body":[{"type":"TextBlock","text":"<title>","weight":"Bolder","size":"Medium","wrap":true},{"type":"TextBlock","text":"<body>","wrap":true}]}}]}`; Generic = `Message.payload` = `{"event": "<when>", "task": {"id","name"}, "run": RunSummary, "title", "body", "outputs": [...] }`. `sign` → Header `X-L8db-Timestamp: <unix>` und `X-L8db-Signature: sha256=<hex(HMAC-SHA256(secret, "<timestamp>.<body>"))>` mit Secret `automation:webhook:<id>:hmac`. Status außerhalb 2xx → Fehler mit Status und max. 300 Zeichen Antwort.

### 8.7 Alarme (`alerts.rs`)

`evaluate`: `has_rows` → `triggered` wenn ≥ 1 Zeile; `no_rows` → `triggered` wenn 0 Zeilen; `value` → Wert = Spalte `column` (sonst erste) der ersten Zeile, `triggered` wenn `compare(wert, op, threshold)`; `error` → `triggered` wenn die Abfrage fehlschlägt. Für alle außer `error`: Abfragefehler → Status `error`. `value` = Messwert bzw. Zeilenzahl als Text.

`transition(previous, evaluation, now, rearm)`:

| vorher | neu | Benachrichtigung |
|---|---|---|
| `unknown`/`ok`/`error` | `triggered` | `alert_triggered`, `since = now`, `last_notified_at = now` |
| `triggered` | `triggered` | nur wenn `rearm_minutes` gesetzt und `now - last_notified_at ≥ rearm` → `alert_triggered` (Erinnerung), `last_notified_at = now` |
| `triggered` | `ok` | `alert_resolved` (Regel greift nur, wenn `notify_on_resolve`), `since = now` |
| beliebig | `error` | keine eigene; der Lauf protokolliert `warn`; Regeln mit `failure` greifen nicht, weil der Schritt erfolgreich ist |
| gleich bleibend `ok` | `ok` | keine |

`muted_until > now` unterdrückt jede Benachrichtigung (Zustand wird trotzdem fortgeschrieben).

---

## 9. Zeitpläne und Scheduler

### 9.1 Zeitlogik (`schedule.rs`, rein funktional, vollständig unit-getestet)

- Zeitzone: `schedule.timezone` als `chrono_tz::Tz`; `None` → System-Zeitzone (Ermittlung über Umgebungsvariable `TZ`, sonst `/etc/localtime`-Symlink, sonst UTC; Windows: UTC-Offset der lokalen Zeit über `chrono::Local`). Implementierung: `enum Zone { Named(Tz), Local }` mit gemeinsamer Funktion `to_utc(naive) -> Option<DateTime<Utc>>`.
- Lokale Zeit → UTC bei DST: Lücke (nicht existierende Zeit, z. B. 02:30 am Umstellungstag) → nächste gültige Minute danach; Überlappung → frühere Instanz (`LocalResult::Ambiguous(earliest, _)`).
- `next_runs(schedule, after, count)`: liefert die nächsten Zeitpunkte **strikt nach** `after`, gefiltert durch `start_at` (≥), `end_at` (≤), `exclusions` (lokales Datum), `window` (nur `interval`: lokale Uhrzeit in `[from, to)`; `to < from` = über Mitternacht). Abbruch der Suche nach 1 000 Kandidaten oder 5 Jahren → was gefunden wurde.
- Trigger:
  - `interval`: Anker = `start_at` sonst `2000-01-01T00:00` lokal; Zeitpunkte `anchor + k * every * unit` (Tage als Kalendertage in lokaler Zeit, Minuten/Stunden als absolute Dauer). `every ≥ 1`; Minuten-Intervalle < 1 sind ungültig.
  - `daily`: jede Uhrzeit aus `times` an jedem Tag.
  - `weekly`: `weekdays` 1 = Montag … 7 = Sonntag (ISO), leer ungültig.
  - `monthly`: `days` 1–31 (Tag existiert im Monat nicht → übersprungen) und/oder `last_day`.
  - `monthly_nth`: `nth` 1–4 oder −1 (letzter), `weekday` 1–7.
  - `cron`: `croner::Cron::from_str(expression)`; 5 Felder (Minute) oder 6 Felder (mit Sekunden vorn); Unterstützung für `L`, `#`, `W` laut `croner`; Auswertung `find_next_occurrence(&now_in_tz, false)` iterativ. (Spike am 2026-10-04: `0 0 9 * * MON-FRI` und `0 12 L * *` mit `Europe/Berlin` liefern korrekte Zeitpunkte.)
  - `once`: genau `at` (lokal), falls in der Zukunft.
  - `app_start`, `after_task`: keine Zeitpunkte (`next_runs` → leer), werden ereignisgesteuert ausgelöst.
- `next_run(task, after)`: Minimum über alle aktiven Zeitpläne.
- `validate`: Uhrzeiten `HH:MM` (00–23, 00–59), Daten gültig, Zeitzone bekannt, Cron parsebar, `after_task` nicht auf sich selbst.

### 9.2 In-App-Scheduler (`scheduler.rs::spawn`)

- Tokio-Task, Takt: am Anfang jeder vollen Minute + 2 s und zusätzlich bei `reschedule`/Settings-Änderung über einen `tokio::sync::Notify`. Zusätzlich alle 30 s Heartbeat (`app_heartbeat`) und Lease-Heartbeats laufender Läufe (macht die Engine).
- `settings.scheduler_enabled == false` → nur Heartbeat, keine Läufe (UI-Schalter „Zeitpläne pausieren“).
- Pro Takt für jeden aktiven Task (`enabled`, nicht `needs_review`): ist `task_state.next_run_at ≤ now`? → bestimmen, welcher Zeitplan fällig ist (für `vars`/`environment` des Zeitplans), `engine::start(RunRequest{ trigger: Schedule, trigger_detail: Some(schedule_id), … })`; bei `AlreadyRunning` einen `skipped`-Lauf protokollieren (Lauf-Zeile mit `status = skipped`, `error = "Vorheriger Lauf noch aktiv."`). Danach `next_run_at = next_run(task, now)`.
- Verpasste Läufe: Beim Start und bei jedem Takt gilt ein Termin als verpasst, wenn `next_run_at < now - 120 s`. `skip` → ohne Lauf neu berechnen; `run_once` → genau ein Lauf mit `trigger_detail = "nachgeholt"`, danach neu berechnen.
- `app_start`: einmal pro App-Prozess nach `delay_seconds` (gilt nur in der App, nicht im Tick).
- `on_run_finished(run)`: für alle aktiven Tasks mit `after_task { task_id == run.task_id, on }` passend zu `run.status` (`success` umfasst `warning`; `failure` umfasst `failed` und `timeout`; `cancelled`, `skipped` lösen nichts aus) → `engine::start(trigger: AfterTask, trigger_detail: run.id)`. In der CLI genauso (Kette läuft im selben Prozess, `execute` statt `start`).
- `reschedule(task_id)`: `next_run_at` neu berechnen und Takt wecken.
- Start: `store.mark_interrupted()`, `next_run_at` für alle Tasks berechnen, deren Wert fehlt.

### 9.3 Headless-Tick (`scheduler.rs::tick`)

1. Store öffnen (Fehler → Exit 6).
2. Heartbeat der App jünger als 90 s → `TickReport { app_running: true }` und Ende (Exit 0).
3. Sonst `mark_interrupted()`, dann für alle aktiven Tasks mit `background == true` dieselbe Fälligkeits- und Nachhollogik wie 9.2 (Trigger `Background`), Läufe sequentiell über `engine::execute`. `after_task`-Ketten laufen mit. Läufe, deren Lease besteht (weil ein vorheriger Tick noch arbeitet), werden übersprungen.
4. Ein Tick schreibt `settings.last_tick` = `{ at, pid }` (für `BackgroundStatus.last_tick_at`).

### 9.4 Frontend: Task-Center und Dynamic Island

`src/lib/automation/task-bridge.ts::initAutomationTaskBridge()` (in jedem Fenster, gestartet von `initAutomationSync`):
- `run_started` → `startTask({ id: "automation:" + run.id, title: "Automatisierung · " + run.taskName, total: run.stepsTotal }, () => cancelAutomationRun(run.id))`.
- `run_step` → `updateTask(id, { progress: stepsDone, detail: "Schritt " + (seq) + ": " + stepName })`.
- `run_finished` → `finishTask(id, { rows: [] }, status === "failed" || status === "timeout" ? new Error(run.error ?? "Fehlgeschlagen") : undefined)`; `cancelled` → `finishTask(id, undefined, new Error("Vom Benutzer abgebrochen."))` (wird von `finishTask` als abgebrochen erkannt).
- Läufe mit `trigger === "schedule" | "background" | "after_task" | "app_start"` erscheinen genauso – dadurch zeigt die Dynamic Island über `taskMoment` automatisch Erfolg/Fehler. Keine eigene Island-Integration.

---

## 10. Headless-CLI und Hintergrundmodus

### 10.1 Aufrufe (`cli.rs`, eingebunden in `lib.rs::run()` vor dem Builder)

```text
l8db --run-task <id|name> [--var NAME=WERT]... [--env NAME] [--from-step <id|nummer>] [--json] [--quiet]
l8db --list-tasks [--json]
l8db --automation-tick [--json]
```

`lib.rs`: `if args.iter().any(|a| a == "--run-task" || a == "--list-tasks" || a == "--automation-tick") { std::process::exit(automation::cli::cli(&args)); }` – direkt nach dem `--check`-Zweig, vor `--benchmark`.

- Runtime: `tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all()` (Tunnel-Forwarder brauchen einen zweiten Thread).
- `Services { store: Store::open_default()?, pool: create_pool_state(), ssh: create_ssh_state(), transactions: create_transaction_state(), sink: stderr-Sink, headless: true }`.
- `--run-task`: Task per ID, sonst Name (Groß/Klein egal). `--var` mehrfach, `NAME=WERT` am ersten `=` getrennt; unbekannte Variable → Exit 2 (`Unbekannte Variable „x“. Bekannt: a, b.`). Variablen mit `prompt` bekommen ihren Default (keine Rückfrage). Deaktivierte Tasks laufen (CLI zählt als manueller Start), `needs_review` bleibt gesperrt (Exit 4). Trigger `Cli`. Ausgabe: Fortschritt auf stderr (außer `--quiet`/`--json`), am Ende auf stdout eine Zusammenfassung bzw. mit `--json` `RunDetail` ohne `definition`. SIGINT/Ctrl-C → `engine::cancel`, Exit 8.
- `--list-tasks`: Tabelle `ID  Name  Aktiv  Nächster Lauf  Letzter Status` bzw. `--json` = `TaskSummary[]`.
- `--automation-tick`: siehe 9.3, `--json` gibt `TickReport` aus.

### 10.2 Exit-Codes

| Code | Bedeutung |
|---|---|
| 0 | Lauf erfolgreich (auch `warning`), bzw. Liste/Tick ohne Fehler |
| 1 | Lauf fehlgeschlagen (`failed`) |
| 2 | Aufruf ungültig (unbekanntes Argument, fehlender Wert, unbekannte Variable) |
| 3 | Task nicht gefunden oder Name mehrdeutig |
| 4 | Task gesperrt (`needs_review`) oder Definition ungültig |
| 5 | Task läuft bereits (Lease aktiv) |
| 6 | Automatisierungsdatenbank nicht lesbar oder von neuerer Version |
| 7 | Zeitüberschreitung (`timeout`) |
| 8 | Abgebrochen (Signal) |
| 10 | Lauf erfolgreich, aber mindestens ein Alarm-Schritt ist `triggered` |

Beim Tick: 0, sofern der Tick selbst funktionierte (Fehler einzelner Läufe stehen in der Historie), 6 bei Store-Fehler.

### 10.3 Hintergrundmodus (`os_scheduler.rs`)

Ein einziger Eintrag ruft minütlich `"<absoluter Pfad zu current_exe()>" --automation-tick` auf. Release-Build vorausgesetzt (Debug-Builds: `supported = false`, `detail = "Nur in installierten Versionen verfügbar."`). macOS: `current_exe()` liegt im App-Bundle (`/Applications/l8db.app/Contents/MacOS/l8db`); wird die App verschoben, zeigt `status` `detail = "Pfad hat sich geändert – bitte neu einrichten."` (gespeicherter Pfad ≠ aktueller).

| Plattform | Mechanismus | Datei/Eintrag | Installieren | Entfernen | Status |
|---|---|---|---|---|---|
| macOS | launchd LaunchAgent | `~/Library/LaunchAgents/com.leon.l8db.automation.plist` mit `Label`, `ProgramArguments [exe, "--automation-tick"]`, `StartInterval 60`, `RunAtLoad false`, `ProcessType Background`, `StandardOutPath`/`StandardErrorPath` = `<config_dir>/automation-tick.log`, `LowPriorityIO true` | plist schreiben, `launchctl bootstrap gui/<uid> <plist>` (bei „already bootstrapped“ erst `bootout`) | `launchctl bootout gui/<uid>/com.leon.l8db.automation`, plist löschen | plist existiert + `launchctl print gui/<uid>/com.leon.l8db.automation` Exit 0 |
| Linux (bevorzugt) | systemd User-Timer | `~/.config/systemd/user/l8db-automation.service` (`Type=oneshot`, `ExecStart="<exe>" --automation-tick`) und `l8db-automation.timer` (`OnCalendar=*-*-* *:*:00`, `AccuracySec=10s`, `Persistent=false`, `WantedBy=timers.target`) | Dateien schreiben, `systemctl --user daemon-reload`, `systemctl --user enable --now l8db-automation.timer` | `disable --now`, Dateien löschen, `daemon-reload` | `systemctl --user is-enabled l8db-automation.timer` |
| Linux (Fallback, wenn `systemctl --user` nicht nutzbar) | crontab | Zeile `* * * * * "<exe>" --automation-tick # l8db-automation` | `crontab -l` lesen, alte markierte Zeile ersetzen, `crontab -` schreiben | markierte Zeile entfernen | Zeile vorhanden. Hinweis in `detail`: „Unter cron ist der Schlüsselbund ggf. nicht erreichbar.“ |
| Windows | Aufgabenplanung | Aufgabe `l8db\Automatisierung` | `schtasks /Create /F /TN "l8db\Automatisierung" /SC MINUTE /MO 1 /TR "\"<exe>\" --automation-tick" /IT` (nur bei angemeldetem Benutzer, damit Credential Manager erreichbar ist) | `schtasks /Delete /F /TN "l8db\Automatisierung"` | `schtasks /Query /TN "l8db\Automatisierung"` Exit 0 |

Alle Befehle über `std::process::Command` mit Argument-Arrays (keine Shell-Strings außer dem `/TR`-Wert, dessen Pfad in `"` steht). Datei-Inhalte werden von reinen Funktionen erzeugt (`launchd_plist(exe, log) -> String`, `systemd_units(exe) -> (String, String)`, `cron_line(exe) -> String`, `schtasks_create_args(exe) -> Vec<String>`), damit sie ohne Systemeingriff testbar sind. Installieren/Entfernen selbst wird nur manuell bzw. in einem `#[ignore]`-Test (macOS) geprüft.

Schlüsselbund im Hintergrund: macOS-LaunchAgents laufen in der Benutzersitzung, der Keychain-Eintrag gehört derselben signierten Binärdatei → kein Dialog. Linux: Secret Service braucht den D-Bus der Sitzung (systemd-User-Units haben ihn). Windows: Credential Manager mit `/IT`. Debug-Builds nutzen `~/.l8db-dev-secrets.json` (siehe `db::secrets`), dadurch ist die CLI-E2E ohne Keychain möglich (`L8DB_DEV_SECRETS`).

`command_line(task)` für „Als Befehl kopieren“: macOS/Linux `'<exe>' --run-task '<id>'` (POSIX-Quoting), Windows `"<exe>" --run-task "<id>"`.

---

## 11. Frontend-Struktur

### 11.1 Registrierung

- **Route** `src/routes/_app._workspace.automation.tsx`:
  ```tsx
  import { createFileRoute } from "@tanstack/react-router";

  import { AutomationView } from "@/features/automation/automation-view";

  export const Route = createFileRoute("/_app/_workspace/automation")({
    component: AutomationView,
  });
  ```
  Danach `src/routeTree.gen.ts` durch `bun run build` (oder Dev-Start) regenerieren und die generierte Änderung mitliefern.
- **Tool-Tab** `src/lib/tool-tabs.ts`: `ToolId` um `"automation"` erweitern, Eintrag
  ```ts
  automation: {
    path: "/automation",
    label: "Automatisierung",
    Icon: WorkflowIcon,
    iconColor: "text-fuchsia-500",
    Component: lazy(() =>
      import("@/features/automation/automation-view").then((m) => ({ default: m.AutomationView })),
    ),
  },
  ```
  (`WorkflowIcon` aus `lucide-react`.)
- **Sidebar** `src/features/sidebar/app-sidebar-data.ts`: nach „Gespeicherte Pläne“ `{ title: "Automatisierung", url: "/automation", icon: WorkflowIcon, featureScope: "automation" }` (kein `available` – verbindungsunabhängig).
- **NEW-Badges** (`src/lib/new-features.ts`, Version `"0.10.0"`): `"automation.tasks"`, `"automation.schedules"`, `"automation.notifications"`, `"automation.history"`, `"automation.alerts"`, `"automation.background"`. Die Sidebar zeigt über `featureScope: "automation"` den Punkt. Am tatsächlichen Element per `useNewFeatureVisibility(featureId)` + `NewBadge`: „Neuer Task“-Button (`automation.tasks`), Tab „Zeitplan“ im Editor (`automation.schedules`), Tab „Benachrichtigungen“ (`automation.notifications`), Ansicht „Verlauf“ (`automation.history`), Ansicht „Alarme“ (`automation.alerts`), Abschnitt „Im Hintergrund ausführen“ in den Einstellungen (`automation.background`). Wegweiser (Ansichts-Umschalter „Verlauf“/„Alarme“/„Einstellungen“, Editor-Tabs) zeigen `useHasNewFeatures(scope)` + `NewBadge`, wie in `docs/new-feature-badges.md` beschrieben.
- **Start** `src/main.tsx`: im vorhandenen `requestAnimationFrame`-Block neben `initMcpSync` ergänzen: `void import("@/lib/automation/sync").then(({ initAutomationSync }) => initAutomationSync()).catch(() => undefined);`
- **Capabilities**: `src-tauri/capabilities/default.json` enthält `opener:default`; „Im Ordner zeigen“ nutzt `revealItemInDir` aus `@tauri-apps/plugin-opener`. Falls `opener:default` das nicht abdeckt, `"opener:allow-reveal-item-in-dir"` ergänzen (WP1 prüft beim Start).

### 11.2 `src/lib/automation/` (Logik ohne JSX)

| Datei | Inhalt | Paket |
|---|---|---|
| `sync.ts` | `buildAutomationConnection(c: SavedConnection): AutomationConnection`, `initAutomationSync()` (Spiegelung nach 4.1, startet `initAutomationTaskBridge` und den Event-Listener des Stores), entprellt 500 ms, abonniert `useConnectionsStore`, `useSettingsStore` (`sshTrustNewHosts`) und `useBackupToolPaths` (beide Werte werden zusätzlich in `AutomationSettings` gespiegelt, wenn abweichend) | WP5 |
| `task-bridge.ts` | `initAutomationTaskBridge()` nach 9.4 | WP5 |
| `store.ts` | Zustand-Store `useAutomationStore` (nicht persistiert): `tasks: TaskSummary[]`, `loaded`, `selectedId`, `view: "tasks" \| "history" \| "alerts" \| "settings"`, `search`, `folderFilter`, `tagFilter`, `statusFilter`, `selection: string[]`, `runs: RunSummary[]` (letzte 200), `activeRuns: Record<runId, { summary, steps: StepRun[] }>`; Aktionen `load()`, `applyEvent(e)`, `select(id)`; Event-Abo über `onAutomationEvent` (einmal pro Fenster) | WP5 |
| `ui-state.ts` | persistierter Zustand-Store `useAutomationUiState` (`l8db.automation.ui`, `syncAcrossWindows`): eingeklappte Ordner, Spaltenbreite der Liste, letzte Ansicht | WP5 |
| `format.ts` | `runStatusLabel`, `runStatusTone`, `triggerLabel`, `formatDuration`, `formatRelative` (deutsch) | WP5 |
| `defaults.ts` | `newTask(name)`, `newStep(type: ActionType)`, `newSchedule(type)`, `newNotification()`, `DEFAULT_CSV` | WP6 |
| `step-catalog.ts` | `STEP_CATALOG: Record<ActionType, { label; description; group: "Datenbank" \| "Daten" \| "Dateien" \| "Ablauf" \| "Kommunikation"; icon: LucideIcon; risky: boolean }>` | WP6 |
| `schedule-text.ts` | `describeSchedule(s: Schedule, taskNames: Record<string,string>): string` (deutsch, Beispiele unten), `describeTrigger`, `WEEKDAYS` | WP6 |
| `placeholders.ts` | `BUILTIN_PLACEHOLDERS` (Name, Beschreibung, Beispiel) für Autovervollständigung; `findPlaceholders(text)`; `unsafeSqlPlaceholders(sql)` (für die `|sql`-Warnung) | WP6 |
| `templates.ts` | `TASK_TEMPLATES: { id; name; description; build(): Task }[]` – „Nächtliches Backup mit Aufräumen“, „Täglicher CSV-Bericht per E-Mail“, „Abfrage-Alarm“, „Datenqualität prüfen“, „Tabelle spiegeln“, „Skript auf allen Verbindungen mit Tag“, „Webhook bei Fehler“ | WP6 |
| `validation.ts` | Client-seitige Sofortprüfung je Feld (Pflichtfelder, Uhrzeit-Format); die maßgebliche Prüfung ist `validateAutomationTask` | WP6 |

`describeSchedule`-Beispiele (exakt so): `Alle 15 Minuten` · `Alle 15 Minuten, Mo–Fr zwischen 08:00 und 18:00` (Fenster) · `Täglich um 06:00` · `Täglich um 06:00 und 18:00` · `Jeden Montag und Donnerstag um 07:30` · `Werktags um 09:00` (Mo–Fr) · `Monatlich am 1. und 15. um 02:00` · `Monatlich am letzten Tag um 23:00` · `Jeden ersten Montag im Monat um 08:00` · `Jeden letzten Freitag im Monat um 17:00` · `Cron: 0 */2 * * *` · `Einmalig am 24.12.2026 um 10:00` · `Beim Start von l8db (nach 30 s)` · `Nach „Backup“ bei Erfolg` / `bei Fehler` / `immer`. Zusätze: ` · ab 01.11.2026`, ` · bis 31.12.2026`, ` · 3 Ausnahmen`, ` · Europe/Berlin` (nur wenn ≠ Systemzeitzone).

### 11.3 `src/features/automation/` (eine Komponente pro Datei)

Paket WP5 (Rahmen, Listen, Verlauf, Alarme, Einstellungen):

| Datei | Komponente | Zeigt |
|---|---|---|
| `automation-view.tsx` | `AutomationView` | Gesamtlayout: linke Spalte Taskliste (resizable, `ResizablePanelGroup`), rechts je Ansicht Editor/Verlauf/Alarme/Einstellungen; lädt Store; leerer Zustand |
| `automation-toolbar.tsx` | `AutomationToolbar` | Ansichts-Umschalter (Tasks · Verlauf · Alarme · Einstellungen), „Neuer Task“ (Dropdown: Leer / aus Vorlage), Import, Export, Banner „Zeitpläne pausiert“ |
| `automation-empty-state.tsx` | `AutomationEmptyState` | Erklärung + drei Vorlagen-Karten + „Leeren Task anlegen“ |
| `task-list.tsx` | `TaskList` | Suche, Filter (Ordner, Tag, Status), Ordnerbaum aus `folder`, Mehrfachauswahl mit Sammelaktionen |
| `task-list-folder.tsx` | `TaskListFolder` | einklappbarer Ordnerknoten mit Anzahl |
| `task-list-item.tsx` | `TaskListItem` | Name, Status-Punkt (letzter Lauf), „läuft“-Spinner, nächster Lauf relativ („in 3 Std.“), Schalter aktiv, Kontextmenü (Ausführen, Duplizieren, Als Befehl kopieren, Exportieren, Löschen) |
| `task-bulk-bar.tsx` | `TaskBulkBar` | bei Mehrfachauswahl: Aktivieren, Deaktivieren, Exportieren, Löschen |
| `template-picker-dialog.tsx` | `TemplatePickerDialog` | Vorlagen-Galerie (nutzt `TASK_TEMPLATES` aus WP6) |
| `run-prompt-dialog.tsx` | `RunPromptDialog` | vor manuellem Lauf: Umgebung + Variablen mit `prompt` (typgerechte Eingaben, Geheimnisse als Passwortfeld) |
| `delete-tasks-dialog.tsx` | `DeleteTasksDialog` | Bestätigung |
| `import-report-dialog.tsx` | `ImportReportDialog` | Ergebnis mit „muss geprüft werden“-Liste |
| `history-view.tsx` | `HistoryView` | Filterleiste + Laufliste + Detail rechts |
| `history-filters.tsx` | `HistoryFilters` | Task, Status (Mehrfach), Auslöser, Zeitraum (Heute / 7 Tage / 30 Tage / eigener), Volltext, Export JSON/CSV, Löschen |
| `run-list.tsx` | `RunList` | virtualisierte Liste (Status-Icon, Task, Start, Dauer, Auslöser) |
| `run-detail.tsx` | `RunDetail` | Kopf (Status, Dauer, Auslöser, Umgebung, Fehler), Aktionen „Erneut ausführen“, „Ab fehlgeschlagenem Schritt“, „Mit ursprünglicher Definition“, „Abbrechen“ (wenn läuft) |
| `run-timeline.tsx` | `RunTimeline` | Gantt-Balken je `StepRun` (Breite ∝ Dauer, Einrückung = `depth`, Wiederholungen gestapelt, Live-Fortschritt) |
| `run-log.tsx` | `RunLog` | Logzeilen mit Level-Filter und Schritt-Filter, monospace, Kopieren |
| `run-outputs.tsx` | `RunOutputs` | Dateien mit Größe, „Öffnen“, „Im Ordner zeigen“ |
| `alerts-view.tsx` | `AlertsView` | Karten je Alarm-Schritt: Zustand (OK grün, AUSGELÖST rot, FEHLER gelb, UNBEKANNT grau), seit, letzter Wert, letzte Prüfung, Stummschalten (1 h, 8 h, 24 h, bis …, aufheben), „Jetzt prüfen“ (= Task ausführen) |
| `alert-card.tsx` | `AlertCard` | eine Karte |
| `settings-view.tsx` | `AutomationSettingsView` | Abschnitte unten |
| `settings-scheduler-section.tsx` | `SettingsSchedulerSection` | „Zeitpläne in der App ausführen“, max. parallele Läufe, Standard-Ausgabeordner, Standard-Aufbewahrung, Systembenachrichtigung bei Fehlern |
| `settings-background-section.tsx` | `SettingsBackgroundSection` | Status, Einrichten/Entfernen, Pfad, letzter Tick, Hinweise je Plattform |
| `settings-smtp-section.tsx` | `SettingsSmtpSection` | Liste der SMTP-Profile |
| `smtp-profile-dialog.tsx` | `SmtpProfileDialog` | Felder + Passwort (Schlüsselbund) + „Test-Mail senden“ |
| `settings-webhooks-section.tsx` | `SettingsWebhooksSection` | Liste der Webhooks |
| `webhook-dialog.tsx` | `WebhookDialog` | Art, Name, URL (Schlüsselbund), Header, Signatur + Secret, „Test senden“ |
| `planning-overview.tsx` | `PlanningOverview` | in der Tasks-Ansicht ohne Auswahl: „Als Nächstes“ – nächste 24 h aus `automationNextRuns(24)` als Zeitachse |

Paket WP6 (Editor):

| Datei | Komponente | Zeigt |
|---|---|---|
| `task-editor.tsx` | `TaskEditor` (Props: `{ taskId: string \| null; draft?: Task; onSaved(summary: TaskSummary): void; onClose(): void }`) | Kopf mit Name (inline), aktiv-Schalter, „Ausführen“, „Speichern“ (Strg/Cmd+S), Validierungs-Badge; Tabs: Schritte · Zeitplan · Variablen · Benachrichtigungen · Einstellungen; ungespeicherte Änderungen werden beim Wechsel abgefragt |
| `task-editor-header.tsx` | `TaskEditorHeader` | |
| `task-general-tab.tsx` | `TaskGeneralTab` | Beschreibung (Markdown), Ordner (Combobox mit vorhandenen), Tags, Timeout, Standard-Retry, Auto-Deaktivierung, verpasste Läufe, Hintergrund, Aufbewahrung |
| `step-list.tsx` | `StepList` | sortierbare Schrittliste (`@dnd-kit` wie in vorhandenen Listen), Nummer, Icon, Name, Kurzbeschreibung, Fluss-Pfeile („bei Fehler → Schritt 5“), Validierungs-Marker, verschachtelte Schleifen eingerückt |
| `step-list-item.tsx` | `StepListItem` | |
| `step-add-menu.tsx` | `StepAddMenu` | Befehlspalette nach `STEP_CATALOG`-Gruppen mit Suche |
| `step-editor.tsx` | `StepEditor` | rechte Seite: Name, aktiv, typ-spezifisches Formular, Abschnitt „Ablauf“ |
| `step-flow-fields.tsx` | `StepFlowFields` | Bei Erfolg / Bei Fehler (Nächster Schritt · Gehe zu … · Erfolgreich beenden · Mit Fehler beenden), Kurzschalter „Bei Fehler fortsetzen“, Retry, Timeout |
| `connection-picker.tsx` | `ConnectionPicker` | gespeicherte Verbindungen + Variablen (`${…}`), deaktiviert mit Grund (4.2), „Verbindung prüfen“ (`testAutomationConnection`) |
| `template-input.tsx` | `TemplateInput` | Eingabe mit `${`-Autovervollständigung (Variablen, eingebaute, Schritte) |
| `sql-template-editor.tsx` | `SqlTemplateEditor` | Monaco-SQL (vorhandene Einbindung wiederverwenden) mit Platzhalter-Vervollständigung und `|sql`-Warnung |
| `output-spec-fields.tsx` | `OutputSpecFields` | Pfad (Dialog „Speichern unter“ + Vorlage), Zeitstempel, Wenn vorhanden, ZIP, Aufräumen |
| `retry-fields.tsx` | `RetryFields` | |
| `steps/sql-step-form.tsx` … | je Typ eine Datei: `sql`, `export`, `backup`, `restore`, `transfer`, `table-copy`, `datagen`, `import`, `compare`, `check`, `alert`, `shell`, `http`, `file-copy-move` (copy und move), `file-delete`, `mkdir`, `file-exists`, `zip`, `unzip`, `cleanup`, `notify`, `wait`, `set-variable`, `condition`, `loop`, `run-task`, `log`, `fail` → `<Typ>StepForm` | |
| `check-spec-fields.tsx` | `CheckSpecFields` | Auswahl der Prüfungsart + Felder |
| `alert-condition-fields.tsx` | `AlertConditionFields` | |
| `channel-fields.tsx` | `ChannelFields` | System / E-Mail (Profil, An, CC) / Webhook |
| `schedule-tab.tsx` | `ScheduleTab` | Liste der Zeitpläne mit Text (`describeSchedule`), aktiv-Schalter, Hinzufügen |
| `schedule-editor.tsx` | `ScheduleEditor` | Art-Auswahl (Intervall · Täglich · Wöchentlich · Monatlich · Monatlich relativ · Cron · Einmalig · Beim Start · Nach Task), Felder je Art, erweitert: Zeitzone, Start/Ende, Zeitfenster, Ausnahmen, Umgebung, Variablen-Werte; Vorschau |
| `schedule-preview.tsx` | `SchedulePreview` | Satz aus `describeSchedule` + „Nächste Läufe“ (5 Zeitpunkte aus `previewAutomationSchedule`, deutsch formatiert, mit Wochentag) oder Fehlermeldung |
| `time-list-input.tsx` | `TimeListInput` | mehrere Uhrzeiten als Chips |
| `weekday-picker.tsx` | `WeekdayPicker` | Mo–So Toggle-Gruppe + „Werktags“ |
| `variables-tab.tsx` | `VariablesTab` | Tabelle Variablen (Name, Typ, Standardwert, Abfragen, Beschreibung), Geheimnisse mit Schlüsselbund-Feld; Umgebungen (Spalten je Umgebung, Standard-Umgebung) |
| `notifications-tab.tsx` | `NotificationsTab` | Regeln: Wann, Kanal, Titel, Text (TemplateInput, mehrzeilig), Anhänge, „Nicht senden, wenn leer“, „Testen“ |

### 11.4 Oberflächentexte (verbindlich, Auszug)

- Tab-Titel „Automatisierung“; Ansichten „Tasks“, „Verlauf“, „Alarme“, „Einstellungen“.
- Leerer Zustand: Titel „Wiederkehrende Arbeit automatisieren“, Text „Plane Backups, Exporte, Prüfungen und Skripte. l8db führt sie aus, solange die App läuft – oder im Hintergrund.“, Buttons „Leeren Task anlegen“, „Aus Vorlage“.
- Statuswörter: läuft · erfolgreich · mit Warnungen · fehlgeschlagen · abgebrochen · Zeitüberschreitung · übersprungen · unterbrochen.
- Auslöser: manuell · Zeitplan · App-Start · nach Task · Kommandozeile · Hintergrund · aus Task · erneut ausgeführt.
- Schritt-Gruppen und Labels: **Datenbank** – „SQL ausführen“, „Backup“, „Wiederherstellen“, „Testdaten erzeugen“; **Daten** – „Exportieren“, „Importieren“, „Tabellen kopieren“, „Schema übertragen“, „Daten vergleichen“, „Daten prüfen“, „Abfrage-Alarm“; **Dateien** – „Datei kopieren“, „Datei verschieben“, „Dateien löschen“, „Ordner anlegen“, „Datei vorhanden?“, „ZIP erstellen“, „ZIP entpacken“, „Alte Dateien aufräumen“; **Ablauf** – „Bedingung“, „Schleife“, „Warten“, „Variable setzen“, „Task starten“, „Log-Eintrag“, „Mit Fehler abbrechen“; **Kommunikation** – „Benachrichtigen“, „HTTP-Anfrage“, „Programm ausführen“.
- Gefährliche Schritte (`risky: true`: restore, shell, http, file_delete, file_move, cleanup, unzip mit overwrite, datagen) zeigen im Editor ein Warn-Badge „Verändert Daten/Dateien“.
- Hintergrund: Titel „Im Hintergrund ausführen“, Text „l8db startet sich jede Minute kurz unsichtbar und führt fällige Tasks aus, die „Auch im Hintergrund ausführen“ aktiviert haben. Läuft die App, übernimmt sie selbst.“; Buttons „Einrichten“, „Entfernen“; Status „Eingerichtet (launchd)“, „Nicht eingerichtet“, „Zuletzt aktiv: vor 2 Min.“.
- Fehlertexte aus Rust werden unverändert angezeigt (Toast über vorhandenes `sonner`).

---

## 12. UX-Spezifikation

**Layout** (Tool-Tab, volle Höhe):

```text
┌ Toolbar: [Tasks|Verlauf|Alarme|Einstellungen]      [Neuer Task ▾] [Import] [Export] ┐
├──────────────── Liste (resizable, 280 px) ──┬──────────── Detail ───────────────────┤
│ 🔍 Suchen …   [Ordner ▾] [Tags ▾] [Status ▾] │ Task-Editor                          │
│ ▾ Berichte (3)                               │  Name · [aktiv] · ⓘ 2 Hinweise       │
│   ● Täglicher Umsatz   in 3 Std.   [■]       │  [Ausführen ▸] [Speichern]           │
│   ● Wochenbericht      Mo 07:00    [■]       │  Schritte | Zeitplan | Variablen |   │
│ ▾ Wartung (2)                                │  Benachrichtigungen | Einstellungen  │
│   ⟳ Nächtliches Backup  läuft …              │ ┌ Schritte ─────┬ Schritt-Editor ──┐ │
│   ✕ Alte Dumps löschen  fehlgeschl.          │ │1 SQL         │ Formular          │ │
│                                              │ │2 Export → 4? │                   │ │
│                                              │ │+ Schritt     │                   │ │
└──────────────────────────────────────────────┴──────────────────────────────────────┘
```

- Tasks-Ansicht ohne Auswahl → `PlanningOverview` („Als Nächstes“) + zuletzt fehlgeschlagene Läufe.
- Statuspunkt: grün erfolgreich, gelb Warnung, rot fehlgeschlagen/Timeout, grau nie gelaufen, animierter Ring = läuft; deaktivierte Tasks halbtransparent mit „Pausiert“; `disabledReason` als Tooltip; `needsReview` mit Badge „Prüfen“.
- Editor-Speichern: Validierungsfehler blockieren nicht das Speichern, aber das Aktivieren; Hinweise erscheinen als Badge im Kopf und als roter Marker am Schritt/Feld.
- Schritt-Editor zeigt unter jedem Textfeld die verfügbaren Platzhalter per `${`-Vervollständigung; Pfadfelder haben „Durchsuchen …“ (`@tauri-apps/plugin-dialog`).
- Zeitplan-Editor zeigt die Vorschau live (entprellt 300 ms) unterhalb: Satz + 5 Termine („Mo, 05.10.2026, 06:00“). Ungültige Eingaben: rote Meldung statt Terminen.
- „Ausführen“ öffnet `RunPromptDialog` nur, wenn Variablen mit `prompt` oder mehrere Umgebungen existieren; danach springt die Ansicht nicht weg, sondern zeigt unten im Editor eine Live-Leiste („Läuft · Schritt 2/5 Export … [Abbrechen] [Verlauf öffnen]“).
- Verlauf: Liste links, Detail rechts: Kopf, Zeitleiste (Balken je Schritt mit Dauer, Hover = Zeilen/Fehler), Tabs „Log“, „Ausgaben“, „Variablen“ (maskiert), „Definition“ (read-only JSON). Laufende Läufe aktualisieren sich live über Events.
- Alarme: Rasteransicht der Karten, sortiert AUSGELÖST → FEHLER → UNBEKANNT → OK.
- Einstellungen: Abschnitte „Ausführung“, „Im Hintergrund ausführen“, „E-Mail (SMTP)“, „Webhooks“.
- Tastatur: `Cmd/Strg+S` speichern, `Cmd/Strg+Enter` ausführen, `Entf` in Liste löschen (mit Dialog), Pfeiltasten in Listen.
- Barrierefreiheit: alle Icon-Buttons mit `aria-label`, Status nicht nur über Farbe (Icon + Text), Zeitleiste mit Textalternative (Liste).

---

## 13. Snapshot-Scheduler (`useSnapshotScheduler`, `vault::Schedule`)

Befund: Branching (`src-tauri/src/branching/`, `src/lib/branching/`, `src/lib/db/branching.ts`) ist zurzeit **nicht eingecheckter WIP im Haupt-Checkout** und fehlt in diesem Worktree. `useSnapshotScheduler` pollt im Frontend alle 5 min `branching_schedules`, braucht offene Fenster und öffnet Tunnel über das Frontend – genau das Problem, das die Automatisierung löst.

Entscheidung: Der **Zeitplan bleibt Teil der Vault-Policy** (`vault::Schedule{ every_hours, keep, connection_id, last_run_at, last_error }`), weil Aufbewahrung (`keep`) und Signatur an den Vault gebunden sind. Die **Ausführung** wandert in den Rust-Scheduler der Automatisierung; `useSnapshotScheduler` entfällt. Zusätzlich gibt es den Schritttyp „Datenbank-Snapshot“ für eigene Abläufe (z. B. Snapshot vor einem Migrationsskript).

Umsetzung als **Folgepaket WP7**, sobald Branching auf `development` liegt (nicht Teil der v1-Pakete, damit kein Paket gegen nicht existierenden Code baut):

1. `model.rs`: `Action::Snapshot { connection: String, #[serde(default)] database: Option<String> }` (TS: `{ type: "snapshot"; connection: string; database: string | null }`), Katalog-Gruppe „Datenbank“, Label „Datenbank-Snapshot“.
2. `steps/snapshot.rs`: `connection::resolve` → Kontext wie `branching::context(..)` ohne `AppHandle` (Vault-Root über `vault::default_root(None)`), dann `branching::ops::start_snapshot(ctx, SnapshotRequest{ database, scheduled: false, server }, emit)` und auf den Job warten (`branching::jobs`); Ergebnis-ID als `value`.
3. `scheduler.rs`: im Minuten-Takt (App) und im Tick zusätzlich `branching::ops::schedules(&root)` auswerten (fällig: `last_run_at + every_hours ≤ now`, gleiche 30-min-Wiederholungssperre wie `dueSchedules`), Snapshot über dieselbe Funktion wie in Schritt 2 starten; Läufe erscheinen in der Historie als Pseudo-Task `branching:<database>` mit Trigger `schedule`.
4. `src/lib/branching/scheduler.ts` und dessen Aufruf entfernen; `tests` für `dueSchedules` nach Rust portieren.

---

## 14. Neue Abhängigkeiten

Spike am 2026-10-04 in `/tmp` (danach gelöscht) mit `rustc 1.95.0` auf macOS: alle unten genannten Crates bauen und funktionieren zusammen mit `tokio`; `std::fs::File::try_lock` funktioniert. Versionen laut `cargo search`/Lockfile des Spikes.

| Crate | Eintrag in `src-tauri/Cargo.toml` | Zweck | Alternative verworfen |
|---|---|---|---|
| `croner` 4.0.1 | `croner = "4"` | Cron mit 5/6 Feldern, `L`, `#`, `W`, Zeitzonen über `chrono` | eigener Parser: zu fehleranfällig; `cron`-Crate kann kein `L`/`#` |
| `chrono-tz` 0.10.4 | `chrono-tz = "0.10"` | IANA-Zeitzonen | — |
| `lettre` 0.11.23 | `lettre = { version = "0.11", default-features = false, features = ["builder", "smtp-transport", "tokio1", "tokio1-native-tls", "hostname"] }` | SMTP mit STARTTLS/TLS über `native-tls` (wie der Rest der App) | Plugin/externer Dienst: nicht vorhanden |
| `zip` 8.6.0 | `zip = { version = "8", default-features = false, features = ["deflate"] }` | ZIP-Ausgaben, Unzip, XLSX | `flate2` allein kann keine ZIP-Container |
| `notify-rust` 4.18.1 | `notify-rust = "4"` | Systembenachrichtigungen in App **und** Headless-Tick (macOS, Linux D-Bus, Windows Toasts) | `tauri-plugin-notification` braucht einen laufenden Tauri-Kontext und Capabilities, im Tick nicht verfügbar; es nutzt intern ebenfalls `notify-rust` |

Bereits vorhanden und genutzt: `rusqlite` (Store), `reqwest` (HTTP, Webhooks), `hmac` + `sha2` (Signatur), `regex`, `chrono`, `rand`, `calamine` (XLSX-Test), `tokio` (`process`, `time`, `sync`), `tokio-util` (`CancellationToken`), `mime_guess` (Anhänge), `url`, `percent-encoding`. Keine neuen npm-Pakete.

---

## 15. Arbeitspakete

Reihenfolge: **WP1 zuerst und allein** (Ziel: < 1 Tag; danach ist `cargo check` grün und alle Signaturen aus Abschnitt 3 existieren). Danach WP2–WP6 parallel. WP7 erst nach Merge von Branching.

Gemeinsame Regeln: Jede Datei hat genau einen Besitzer. Wer eine fremde Datei ändern muss, meldet das dem Integrator statt sie zu ändern. Schnittstellen aus Abschnitt 3 und Typen aus Abschnitt 6 sind eingefroren. Checks gemäß `AGENTS.md` („Checks for coding agents“) – nur betroffene Tests. Kein Commit durch Pakete.

### WP1 – Fundament (Backend-Kern + TS-Brücke)

Dateien (exklusiv): `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json` (nur falls 11.1 es verlangt), `src-tauri/src/automation/{mod.rs, model.rs, runtime.rs, store.rs, connection.rs}`, `src/lib/db/automation.ts`, `src/lib/db/index.ts`, `.gitignore` (Zeile `!/docs/automation/` ergänzen, sonst ist dieses Dokument nicht versionierbar), sowie **Erstanlage als Stubs** von `vars.rs`, `engine.rs`, `steps/*.rs`, `notify.rs`, `schedule.rs`, `scheduler.rs`, `alerts.rs`, `cli.rs`, `os_scheduler.rs` mit den Signaturen aus Abschnitt 3 (danach gehören sie den jeweiligen Paketen).

Inhalt: alle Commands aus Abschnitt 7 (Wrapper rufen die Paket-Funktionen), `AutomationState` + Setup in `lib.rs` (`.manage(..)`, im `setup` Services bauen mit `app.state::<PoolState>()`, `SshState`, `TransactionState`, Sink `app.emit("automation-event", ..)`, `scheduler::spawn`), CLI-Verzweigung in `lib.rs`, Store komplett (Schema, Migrationen, Leases, Heartbeat, Retention, Revisionen, Import/Export-Datei, Mark-Interrupted), Verbindungsauflösung komplett (Abschnitt 4), Neue Crates.

Akzeptanz:
- `cargo check` und `cargo test automation::store automation::connection automation::model` grün.
- Rust-Tests: `store::tests::{migrates_fresh_db, rejects_newer_schema, revision_conflict, lease_blocks_second_run, expired_lease_is_taken_over, retention_keeps_last_n_and_days, mark_interrupted_sets_status, concurrent_writers_do_not_fail}` (zwei `Store`-Instanzen auf dieselbe Datei in zwei Threads); `connection::tests::{injects_password_from_secret, appends_secret_params, postgres_tunnel_rewrites_hostaddr_and_port, generic_tunnel_rewrites_authority, key_value_string_with_tunnel_is_rejected, tunnel_failure_never_falls_back_to_direct (SSH-Host 127.0.0.1:1 → Fehler, kein Adapter mit Original-URL), vault_and_s3_unsupported, name_lookup_case_insensitive_and_ambiguous}` – Secrets über `L8DB_DEV_SECRETS` (Debug-Backend) in einem Temp-Pfad; `model::tests::{task_roundtrip_matches_fixture, defaults_fill_missing_fields}` mit Fixture `src-tauri/src/automation/fixtures/task-v1.json` (enthält jeden Action-, Trigger-, Check-, Channel-Typ).
- Bun: `tests/automation-types.test.ts` lädt dieselbe Fixture-JSON und prüft per Typ-Zuweisung (`const t: Task = fixture`) und Laufzeit-Check, dass jedes `type`-Literal der TS-Unions in der Fixture vorkommt (verhindert Drift Rust ↔ TS).

### WP2 – Engine, Variablen und Ablauf-/Datenbankschritte

Dateien: `src-tauri/src/automation/{vars.rs, engine.rs}`, `steps/{mod.rs, sql.rs, flow.rs, check.rs, http.rs, shell.rs}`.

Akzeptanz (`cargo test automation::vars automation::engine automation::steps::{sql,flow,check,http,shell}`):
- `vars`: Defaults, Filter (inkl. `sql` mit MySQL-Backslash), relative Daten (fixe Uhr über `Vars::with_clock` nur für Tests), Escape `$${`, unbekannte Variable, Maskierung, `calculate` (Präzedenz, Division durch 0 → Fehler), `compare` (numerisch/Text/Regex/empty).
- `engine` gegen temporäre **SQLite-Datei** (kein Lab nötig): Sequenz; `on_failure: next`; `goto` vorwärts/rückwärts mit Schleifenschutz; Retry fix/exponentiell mit gemessenen Pausen (Pausen in Tests per `RetryPolicy{delay_seconds: 0}` bzw. `tokio::time::pause`); Schritt-Timeout; Task-Timeout; Abbruch während Schritt und während Retry-Pause; `from_step`; deaktivierte Schritte; Lease verhindert Parallel-Lauf; Auto-Deaktivierung nach N Fehlern; `run_task` mit Zyklus → Fehler; Schleife über Query-Zeilen mit `${item.col}`; Bedingung; `set_variable` aus Query; `${step.2.rows}`; Status `warning` durch Prüfung mit Schwere Warnung.
- `check`: jede Prüfungsart gegen SQLite (inkl. Freshness mit festen Zeitstempeln); `http` gegen lokalen `tokio`-TcpListener-Mock (Status, `expect_status`, `capture`); `shell` (`sh -c 'exit 3'` mit `success_codes`, `capture`, Abbruch beendet Prozess; Windows-Tests mit `#[cfg(unix)]` begrenzen).
- Optional mit `L8DB_E2E_PG_URL`: `#[ignore]`-Test SQL-Schritt + Check gegen Postgres.

### WP3 – Daten-, Datei- und Ausgabeschritte, Benachrichtigungen

Dateien: `src-tauri/src/automation/steps/{output.rs, export.rs, xlsx.rs, files.rs, data.rs}`, `src-tauri/src/automation/notify.rs`, Sichtbarkeitsänderung `fn scoped_database` → `pub(crate) fn scoped_database` in `src-tauri/src/db/datagen.rs` (einzige erlaubte Änderung dort).

Akzeptanz (`cargo test automation::steps::{output,export,xlsx,files,data} automation::notify`):
- `output`: Zeitstempel, `rename`-Zählung, `append` mit Header nur bei neuer Datei, `fail`, ZIP, Cleanup (ältere Dateien per `filetime`-freiem Setzen der mtime über `File::set_modified`, std ≥ 1.75).
- `export`: jedes Format aus einer SQLite-Tabelle mit NULL, Unicode, Zahlen, Datumswerten; CSV/TSV byte-genau gegen Erwartung; JSON/JSONL parsebar; XLSX mit `calamine` zurückgelesen; Parquet mit `parquet`-Reader zurückgelesen; `table`-Quelle gegen SQLite nimmt den Query-Pfad (SQLite und DuckDB haben `full_table_export = false`, verifiziert in `db/provider.rs`); der Streaming-Pfad über `export_table_csv` wird als `#[ignore]`-Test gegen Postgres (`L8DB_E2E_PG_URL`) geprüft; `max_rows`-Grenze.
- `files`: Wildcards, Überschreiben, Zip-Slip wird abgelehnt, Cleanup-Reihenfolge.
- `data`: Tabellenkopie SQLite → SQLite (truncate/append), Import CSV → SQLite, Datenvergleich zweier SQLite-Dateien mit `fail_if_different`, Datagen in SQLite; Backup und Restore einer SQLite-Datei (`backup::backup`/`restore` haben einen `DatabaseKind::Sqlite`-Zweig, `capabilities().backup = true`).
- `notify`: Webhook-Bodies je Art als Snapshot, HMAC gegen bekannten Testvektor, Webhook gegen lokalen Mock-Server; SMTP gegen lokalen Mini-SMTP (TcpListener, der `EHLO/MAIL/RCPT/DATA/QUIT` beantwortet) mit `security: none`, Anhang im empfangenen MIME vorhanden; System-Notification nur `#[ignore]`.

### WP4 – Zeitpläne, Scheduler, Alarme, CLI, Hintergrundmodus

Dateien: `src-tauri/src/automation/{schedule.rs, scheduler.rs, alerts.rs, cli.rs, os_scheduler.rs}`, `tests/automation-cli-e2e.test.ts`.

Akzeptanz (`cargo test automation::schedule automation::scheduler automation::alerts automation::cli automation::os_scheduler`):
- `schedule`: Tabellen-Tests für jeden Trigger, DST-Wechsel `Europe/Berlin` (29.03. und 25.10.2026: Lücke 02:30 → 03:00, Überlappung → frühere), Monatsenden (31. in Februar übersprungen, `last_day`), `monthly_nth` −1, Fenster über Mitternacht, Ausnahmen, Start/Ende, Cron 5/6 Felder, `once` in Vergangenheit → leer, ungültige Eingaben.
- `scheduler`: mit fixer Uhr – fälliger Task startet; verpasst + `skip`/`run_once`; `after_task` je Ergebnis; Heartbeat frisch → Tick tut nichts; `background == false` wird im Tick ignoriert; `AlreadyRunning` erzeugt `skipped`-Lauf.
- `alerts`: vollständige Zustandstabelle aus 8.7 inkl. Rearm und Mute.
- `cli`: Argument-Parser (Fehler → 2), Exit-Code-Abbildung aus `RunStatus`/`StartError`.
- `os_scheduler`: Snapshot-Tests der erzeugten plist/Units/Cron-Zeile/schtasks-Argumente, Quoting von Pfaden mit Leerzeichen und `'`.
- **CLI-E2E** `tests/automation-cli-e2e.test.ts` (Muster `tests/check-cli-e2e.test.ts`, aktiviert mit `L8DB_AUTOMATION_E2E=1`, Binary `L8DB_BIN` oder `src-tauri/target/debug/l8db`): Temp-Ordner mit `L8DB_AUTOMATION_DB`, `L8DB_DEV_SECRETS`; Store direkt mit `bun:sqlite` nach Schema v1 (Abschnitt 5) anlegen und Zeilen in `connections`, `tasks`, `task_state`, `settings` schreiben – das Schema ist Teil dieses Vertrags, die CLI bekommt keinen Schreib-Befehl. Szenarien: SQLite-Verbindung (Datei im Temp-Ordner) mit Task „SQL → Export CSV → Prüfung“ → Exit 0, CSV-Inhalt korrekt, Lauf in `runs`; fehlschlagende Prüfung → Exit 1; unbekannter Task → 3; `--var` überschreibt Dateinamen; zweiter paralleler Aufruf während `wait`-Schritt → 5; Alarm ausgelöst → 10; `--list-tasks --json` parsebar; `--automation-tick` mit frischem `app_heartbeat` → `appRunning: true`, ohne → führt fälligen `background`-Task aus.

### WP5 – Frontend: Rahmen, Liste, Verlauf, Alarme, Einstellungen, Sync

Dateien: `src/routes/_app._workspace.automation.tsx`, `src/routeTree.gen.ts` (nur regeneriert), `src/lib/tool-tabs.ts`, `src/features/sidebar/app-sidebar-data.ts`, `src/lib/new-features.ts`, `src/main.tsx` (eine Zeile), `src/lib/automation/{sync.ts, task-bridge.ts, store.ts, ui-state.ts, format.ts}`, alle WP5-Dateien aus 11.3, `tests/automation-sync.test.ts`, `tests/automation-store.test.ts`, `tests/automation-browser.test.ts`, `tests/fixtures/automation-browser.ts`.

Abhängigkeit zu WP6: `AutomationView` rendert `TaskEditor` aus `@/features/automation/task-editor` mit den Props aus 11.3 und `TemplatePickerDialog` nutzt `TASK_TEMPLATES`. WP6 legt als Erstes `task-editor.tsx` (rendert `null`, exportiert den Props-Typ) und `templates.ts` (`TASK_TEMPLATES = []`) an und meldet das; WP5 importiert nur diese Signaturen.

Akzeptanz:
- `npx tsc -p tsconfig.app.json --noEmit`, `bunx biome check` auf eigene Dateien.
- `tests/automation-sync.test.ts` (mock `@tauri-apps/api/core` wie `tests/connections.test.ts`): Passwort und geheime Params fehlen im Descriptor; Read-only/Production-Lock setzt Option und `readOnly`; temporäre Verbindungen fehlen; SSH/Proxy werden 1:1 übernommen; Änderung am Store löst genau einen entprellten Sync aus.
- `tests/automation-store.test.ts`: `applyEvent` für alle Event-Arten; Task-Bridge ruft `startTask`/`updateTask`/`finishTask` mit ID `automation:<runId>`, Abbruch und Fehler korrekt.
- `tests/automation-browser.test.ts` (Playwright, Muster `tests/tour-browser.test.ts`: `dist` per `Bun.serve` auf Port 0 mit CSP, `__TAURI_INTERNALS__`-Stub mit In-Memory-Implementierung aller `automation_*`-Commands und `plugin:event|listen`, aktiviert mit `L8DB_AUTOMATION_BROWSER=1`, vorher `bun run build`): Tab über Sidebar öffnen → leerer Zustand; Vorlage „Täglicher CSV-Bericht“ anlegen, speichern, erscheint in Ordner; Liste filtern; manuell ausführen → simulierte Events → Task-Center-Eintrag und Verlauf mit Zeitleiste; Alarm-Karte stummschalten; Einstellungen: SMTP-Profil anlegen ruft `store_secret` mit `automation:smtp:<id>`; Screenshots je Ansicht nach `test-artifacts/automation/` (hell/dunkel, 1280×800); keine `pageerror`.

### WP6 – Frontend: Task-Editor, Schritte, Zeitplan, Variablen, Benachrichtigungen

Dateien: `src/lib/automation/{defaults.ts, step-catalog.ts, schedule-text.ts, placeholders.ts, templates.ts, validation.ts}`, alle WP6-Dateien aus 11.3 inkl. `src/features/automation/steps/*`, `tests/automation-schedule-text.test.ts`, `tests/automation-editor.test.ts`.

Akzeptanz:
- `tsc`, `biome` wie oben.
- `tests/automation-schedule-text.test.ts`: jede Beispielzeile aus 11.2 exakt.
- `tests/automation-editor.test.ts`: `newStep` für **jeden** `ActionType` erzeugt ein Objekt, das `validation.ts` nur mit erwarteten Pflichtfeld-Hinweisen meldet und das dem Rust-Fixture-Schema entspricht (gleiche Schlüssel); `TASK_TEMPLATES` erzeugen gültige Tasks (keine Validierungsfehler außer fehlender Verbindung); `unsafeSqlPlaceholders`; Vorlagen enthalten keine Secrets.
- Browser-Check: WP5 deckt den Editor im Browser-Test mit ab (Schritt hinzufügen, Zeitplan „Werktags 09:00“ → Vorschau zeigt 5 Termine aus dem Stub, Variablen-Tab, Benachrichtigungs-Tab). WP6 liefert dafür stabile `data-testid`s: `automation-step-list`, `automation-add-step`, `automation-schedule-preview`, `automation-save`, `automation-run`.

### Integration (nach WP2–WP6, durch den Integrator)

`cargo check`, `cargo test automation`, `npx tsc -p tsconfig.app.json --noEmit`, `bunx biome check src/features/automation src/lib/automation src/lib/db/automation.ts`, `bun test tests/automation-*.test.ts`, dann `bun run build` + `L8DB_AUTOMATION_BROWSER=1 bun test tests/automation-browser.test.ts`, `cargo build` + `L8DB_AUTOMATION_E2E=1 bun test tests/automation-cli-e2e.test.ts`. Wegen Sicherheitsrelevanz (Shell, Secrets, Hintergrunddienst) am Ende einmal `coderabbit review --agent --uncommitted --include-untracked --dir /Users/leon/l8db-automation`.

---

## 16. Testplan „vollständig testen“

| Ebene | Was | Wie | Lab |
|---|---|---|---|
| Unit Rust | vars, schedule, alerts, output, xlsx, notify-Bodies, os_scheduler-Dateien, cli-Parser, connection-URL-Umschreibung | `cargo test automation` | keins |
| Integration Rust | Engine end-to-end mit allen dateibasierten Schritten | temporäre SQLite- und DuckDB-Dateien (`tempfile`), lokale TCP-Mocks für HTTP/Webhook/SMTP | keins |
| Integration Rust (optional) | SQL/Export/Check/Backup/Restore/Transfer/Tabellenkopie gegen Postgres; SSH-Tunnel-Auflösung über das vorhandene SSH-Lab | `#[ignore]`, `L8DB_E2E_PG_URL`, `L8DB_E2E_SSH_HOST/_PORT`, `cargo test --lib -- --ignored automation` | Postgres 18 :5433, OpenSSH :2222 (siehe `AGENTS.md`) |
| Unit TS | Sync-Descriptor, Store/Event-Bridge, Zeitplantexte, Defaults/Vorlagen, Typ-Drift | `bun test tests/automation-*.test.ts` | keins |
| Browser | Ansichten, Editor-Flows, Live-Lauf, Einstellungen, Screenshots | Playwright gegen `dist` + `__TAURI_INTERNALS__`-Stub | keins |
| Headless E2E | echtes Binary, temporäre DB, SQLite-Ziel, Exit-Codes, Tick | `L8DB_AUTOMATION_E2E=1 bun test tests/automation-cli-e2e.test.ts` | keins |
| Manuell (Release-Build) | Hintergrundmodus wirklich einrichten (launchd), App schließen, Task mit Intervall 1 min, Systembenachrichtigung erscheint, Keychain ohne Dialog, Entfernen räumt plist ab | Checkliste im PR | macOS |

---

## 17. Änderungen an diesem Vertrag

Abweichungen mit Datum, Paket und Begründung:

- **2026-10-04 · WP1 · Schrittsignaturen:** `<Config>` ist überall `&Action` (die Varianten haben keine eigenen Config-Structs); jede Funktion destrukturiert ihre Variante. Der Schritt `notify` liegt als `notify::notify(ctx, &Action)` in `notify.rs` (WP3), weil `steps/` keine passende Datei hat. `steps/mod.rs::run` enthält bereits die vollständige Zuordnung Action → Funktion.
- **2026-10-04 · WP1 · `AutomationState`:** zusätzliches Feld `failure: OnceLock<String>`. Schlägt `Store::open_default` beim Start fehl (z. B. neuere Schema-Version), liefern alle Commands diese Meldung statt „Automatisierung wird gestartet …“, damit die App das Banner zeigen kann. Start über `automation::init(app)` im `setup`-Hook.
- **2026-10-04 · WP1 · TS `DatagenLocale`:** wird in `src/lib/db/automation.ts` aus `./datagen` importiert statt neu deklariert (identischer Typ; `export *` in `src/lib/db/index.ts` meldet sonst TS2308).
- **2026-10-04 · WP1 · Import-Prüfung:** Zusätzlich zu den Schritttypen aus Abschnitt 7 setzen auch Benachrichtigungsregeln mit E-Mail-Kanal `needsReview`, weil ein importiertes `to` Daten über ein lokales SMTP-Profil nach außen senden könnte.
- **2026-10-04 · WP1 · Zeitstempel:** `runtime::now()`/`runtime::rfc3339()` erzeugen RFC 3339 UTC mit Millisekunden (`2026-10-04T07:30:00.123Z`). Der Store vergleicht Lease- und Startzeiten als Text; alle Pakete müssen Zeitpunkte über diese Funktionen schreiben.
- **2026-10-04 · WP1 · Ergänzungen (additiv, Signaturen aus Abschnitt 3 unverändert):** `Services::{new(store, sink, headless), emit(event)}`, `impl Display for StartError` (deutsche Meldungen), `runtime::{now, rfc3339, new_run_id, new_id}`, `Action::kind() -> &'static str` (Wert für `StepRun.kind`), `Store::{duplicate_task, import_tasks, path}`, `store::{renew_ids, requires_review, export_file, parse_import, unique_name, NEWER_SCHEMA, INTERRUPTED}`, `connection::{Via::label, tunnel_id, with_password, with_secret_params, rewrite_host_port, tunneled, ssh_request, NetworkSecrets}`, `automation::{RunTaskInput, PlannedRun}`. `Resolved` und `Via` sind `Debug`, `Via` zusätzlich `Copy + PartialEq`. `mark_interrupted` löscht zusätzlich abgelaufene Leases. `Store::open` wiederholt die Migration bis 5 s lang, wenn ein zweiter Prozess die Datei gleichzeitig anlegt (sonst `database is locked`).
- **2026-10-04 · WP6 · `describeSchedule` mit Zeitfenster:** `TimeWindow` hat keine Wochentage, daher lautet der Text „Alle 15 Minuten zwischen 08:00 und 18:00“ statt „Alle 15 Minuten, Mo–Fr zwischen 08:00 und 18:00“. Label „Monatlich relativ“ für `monthly_nth`.
- **2026-10-04 · WP6 · Ungespeicherte Änderungen:** Statt eines Dialogs beim Wechsel merkt sich der Editor den Entwurf (`src/lib/automation/editor-drafts.ts`, nur im Speicher), zeigt einen Toast mit „Zurück“ und beim erneuten Öffnen den Hinweis „Nicht gespeicherte Änderungen wiederhergestellt · Verwerfen“. `store.select` bleibt unverändert.
- **2026-10-04 · WP6 · Zusätzliche Dateien:** `src/lib/automation/{labels,step-tree,step-summary,editor-drafts}.ts`; `placeholders.ts` zusätzlich `placeholderSuggestions`. Komponenten zusätzlich zu 11.3: `step-action-form`, `step-catalog-grid`, `step-form-context`, `task-run-bar`, `use-task-draft`, `form-row`, `form-section`, `chips-input`, `key-value-fields`, `switch-row`, `path-input`, `connection-fields`, `flow-select`, `comparator-select`, `secret-value-field`, `variable-default-input`.
- **2026-10-04 · WP6 · Speichern mit Fehlern:** Ist der Task aktiv und hat Fehler, wird er pausiert gespeichert (Toast „Gespeichert, aber pausiert“); der Aktiv-Schalter ist bei Fehlern gesperrt.
- **2026-10-04 · WP2 · Ergänzungen (additiv, Signaturen aus Abschnitt 3 unverändert):** `Vars` ist `Clone`; zusätzlich `Vars::{set_timezone, set_builtin, get}` und (nur Tests) `Vars::with_clock`; freie Funktionen `vars::{valid_name, value_text, format_number, sql_literal}` (`sql_literal(value, Some(kind))` ist das `|sql`-Escaping für andere Pakete). `engine::retry_delay` sowie crate-intern `engine::{run_nested, call_path, depth, queue_notification}`; Helfer `steps::{open, first_cell, cell, resolve_path, wrong_action}` (Pfadregeln aus 8.3), `steps::http::parse_expect`, `steps::check::parse_timestamp`.
- **2026-10-04 · WP2 · Semantik-Festlegungen:** `set_step(index, …)`: `index` ist die 1-basierte Position auf oberster Ebene, `0` = verschachtelter Schritt (nur `step.<id>.*` und `last.*`). `${item.index}` ist 1-basiert. `end_success`/`end_failure` in einer Schleife beenden nur den aktuellen Durchlauf (Fehler zählt als Durchlauffehler). Zeitplan-`vars`, `environment` und `timezone` wertet die Engine selbst aus, wenn `trigger ∈ {schedule, background}` und `trigger_detail` die Zeitplan-ID ist (WP4 muss nichts zusammenführen). Unbekannte Umgebung → Lauf `failed` (`Umgebung „x“ existiert nicht.`). Alarm-Benachrichtigungen werden im Lauf gesammelt und am Laufende nach der Status-Benachrichtigung an `notify::dispatch` übergeben. `job_id` kürzt die Step-ID auf 64 Zeichen (Grenze 128 in `execution::run`). Abbruch/Task-Timeout warten bis 5 s auf den laufenden Schritt, danach wird er verworfen. Shell-Prozesse laufen in eigener Prozessgruppe; Abbruch beendet die ganze Gruppe.
- **2026-10-04 · WP3 · Testbare Kerne:** `Vars` ist bis WP2 ein Stub (`Vars::new` liefert `Err`), daher lässt sich in WP3 kein `StepContext` bauen. Jede Schrittfunktion ist eine dünne Hülle (Platzhalter rendern, Verbindung auflösen) um eine öffentliche Kernfunktion mit konkreten Werten, die die Tests direkt nutzen: `output::{plan_target, finalize, cleanup_dir, zip_files, absolute}`, `export::{run_export, write_file}`, `files::{transfer_files, delete_files, unzip_archive, matches}`, `data::{run_backup, run_restore, run_transfer, copy_tables, generate, import_file, run_compare}`, `notify::{webhook_body, signature, email, substitute}`. Ende-zu-Ende über `steps::run` testet die Integration nach WP2.
- **2026-10-04 · WP3 · Ausgabeordner/Zeitstempel:** `output::target_path`/`output::path` lesen den Standard-Ausgabeordner über `ctx.vars.render("${output_dir:-}")` und den Zeitstempel über `${timestamp}` (beides eingebaute Variablen aus 8.2). WP2 muss `${output_dir}` aus `settings.default_output_dir` befüllen (leer, wenn nicht gesetzt).
- **2026-10-04 · WP3 · Import:** Statt `adapter.csv_import` ruft der Import-Schritt `db::commands::run_csv_import` auf. Nur so funktionieren SQLite, MySQL usw. (der generische Pfad `db::import::import`); `adapter.csv_import` gibt es nur für Postgres und MongoDB.
- **2026-10-04 · WP3 · CSV/TSV-Export:** Statt `CsvFileWriter` schreibt der Export über `csv_line`/`csv_row_line` + `AtomicFile`. Das ist byte-gleich zu `CsvFileWriter` (kein abschließender Zeilenumbruch), unterstützt aber zusätzlich `if_exists = append`; der Streaming-Pfad bleibt `export_table_csv`, außer bei `append`.
- **2026-10-04 · WP3 · Benachrichtigungstexte:** `dispatch` rendert über `Vars::new(task, run_id, env, run.vars, {})` + `run.*`-Werte. Scheitert das (zum Beispiel, weil der Lauf genau an einer fehlenden Pflicht-Variable gescheitert ist), greift eine einfache Ersetzung aus `run.vars` + Laufwerten (`${name}`, `${name:-default}`, Filter werden ignoriert, Unbekanntes bleibt stehen), damit Fehlermeldungen immer ankommen. Webhook-Header werden nicht gerendert, weil `Message` keine Variablen trägt; sie gehen unverändert raus.
- **2026-10-04 · WP3 · Restore „production“:** Die Sperre prüft `Resolved.environment` ohne Beachtung der Groß-/Kleinschreibung auf `production`. Schreibende Datenschritte (Restore, Transfer, Tabellenkopie, Testdaten, Import) lehnen `read_only`-Verbindungen zusätzlich in Rust ab.
- **2026-10-04 · INT · Vergleich ohne `compare_columns`:** `data_compare::CompareRequest` hat das zusätzliche Feld `compare_all` (Serde-Standard `false`). Der Compare-Schritt setzt es; bei leerem `compare_columns` werden dann alle Nicht-Schlüsselspalten der linken Seite verglichen. Die App sendet das Feld nicht, ihr Verhalten bleibt unverändert.
- **2026-10-04 · INT · Query-Timeout:** `execution::without_query_limit(future)` hebt die Obergrenze von 300 s in `query_duration` auf (Untergrenze 5 s bleibt; Deckel `UNCLAMPED_MAX_SECONDS` = 30 Tage). Die Engine führt jeden Schritt darin aus, mit `query_timeout` = Schritt-Timeout, sonst Task-Timeout, sonst der Deckel. Die Zeitgrenzen setzt dann die Engine durch. Für die App gilt weiter 5–300 s.
- **2026-10-04 · INT · Abbruch in der CLI:** `tokio::signal::ctrl_c` ersetzt `libc::signal`. Unter Unix beendet zusätzlich SIGTERM über `tokio::signal::unix` den Lauf. In `Runner::attempt` hat ein Stopp (Abbruch, Task-Timeout) per `biased` Vorrang vor dem Schrittergebnis. Sonst endete ein abgebrochener Lauf als `failed` mit der Meldung „Abgebrochen.“ des Schritts statt als `cancelled` (Exitcode 1 statt 8).
- **2026-10-04 · INT · `record_finish`:** Die Methode schreibt per Upsert. Fehlt die `task_state`-Zeile, wird sie angelegt.
- **2026-10-04 · FINAL · Navigation ohne Verbindung:** `AppSidebarNavItem.connectionFree` (nur „Automatisierung“). Nav-Rail und Kopfnavigation zeigen ohne aktive Verbindung „Verbindungen“ plus alle `connectionFree`-Einträge.
- **2026-10-04 · FINAL · Toasts:** Alle Toasts des Tabs laufen über `src/lib/automation/toast.ts` und erscheinen unten rechts (`position: "bottom-right"`, Abstand 40 px über der Statusleiste), weil die globale Position oben mittig Kopf und Editor-Buttons verdeckte. `ToastDrop` animiert nur Toasts mit `data-y-position="top"`; andere Tabs sind unverändert.
- **2026-10-04 · FINAL · Entwurf in der Liste:** Ein ungespeicherter Entwurf steht als „Entwurf · nicht gespeichert“ oben in der Taskliste; der Name folgt dem Editor über `store.renameDraft`. Nach dem ersten Speichern meldet der Editor beim Wechsel keinen falschen „nicht gespeichert“-Toast mehr.
- **2026-10-04 · FINAL · AWS-Hinweis:** Umgesetzt in den Task-Einstellungen unter „Auch im Hintergrund ausführen“ (`src/lib/automation/aws-env.ts`), sobald ein Schritt eine AWS-Verbindung ohne Schlüssel und ohne Profil nutzt.
- **2026-10-04 · FINAL · Rust:** `StepOutcome.alert` und `Store::save_task_state` entfernt (ungenutzt; der Alarmschritt speichert und meldet seinen Zustand selbst).
- **2026-10-04 · FINAL · Layout:** Liste standardmäßig 280 px und pixelstabil beim Ändern der Fenstergröße. Schrittliste und Schritt-Editor stehen ab 36 rem Editorbreite nebeneinander. Der Editor-Kopf hat zwei feste Zeilen (Name + Schließen, darunter Status, Aktiv, Ausführen, Speichern); unter 28 rem zeigen „Bereit“ und „Ausführen“ nur Icons.
- **2026-10-04 · REVIEW · after_task-Zyklen:** Vor dem Start eines Folgetasks verfolgt `after_run` die Kette des auslösenden Laufs rückwärts (`trigger = after_task`, `trigger_detail` = Run-ID des Vorgängers, `Store::get_run`, höchstens 32 Glieder). Kommt der Folgetask in der Kette schon vor (auch der auslösende Task selbst), wird er nicht gestartet: `log::warn!` und ein Eintrag in `TickReport.failed`. A ↔ B oder A → B → C → A laufen so genau eine Runde. Kein neues Feld im Datenmodell.
- **2026-10-04 · REVIEW · Stabile Schlüssel für geheime Variablen:** `Variable` und `Environment` haben ein optionales Feld `id` (Serde-Standard leer, wird leer nicht serialisiert; TS `id?: string`). Das Schlüsselbund-Konto nutzt `id`, sonst den Namen (`model::secret_account`, TS `src/lib/automation/secrets.ts`). Neue Variablen und Umgebungen bekommen eine zufällige ID; beim ersten Ändern eines Eintrags ohne ID wird der bisherige Name als ID festgeschrieben. So bleibt das Konto beim Umbenennen gleich. Beim Speichern löscht der Editor Konten, die im gespeicherten Stand nicht mehr vorkommen (entfernte geheime Variable, entfernte Umgebung, Typwechsel weg von „Geheim“). Das Löschen eines Tasks entfernt alle Konten inklusive der Umgebungs-Konten.
- **2026-10-04 · REVIEW · Kleinere Korrekturen:** Webhook-Dialog verlangt beim Einschalten der Signatur ein neues Secret, außer der Webhook war schon signiert. Die Liste fehlgeschlagener Läufe in der Planung lädt neu, sobald sich die letzte Run-ID eines Tasks ändert (also bei `run_finished`). Das Chip-Feld übernimmt bei jeder Taste, die zu `separators` passt. Die Prüfung auf unbekannte Variablen akzeptiert zuerst den vollen Namen (`report.dir`) und erst danach den Wurzelnamen.
- **2026-10-04 · DESIGN · Feinschliff Automatisierung:** Kein Umbau, nur Korrekturen im bestehenden Stil. Variablen: stabile Zeilen-Keys, neue Zeilen blenden per `@starting-style` ein (nur Transform/Opacity, `motion-reduce` ohne Versatz), Raster per Container-Query (`@xl/var`), damit der Name bei 1024 px nicht gestaucht wird. Trigger-Auswahl und Wochentage mit Druck-Feedback `scale(0.96)`. Schritt-Editor wechselt nur noch per Fade. Kontrast: Zähler und Wochenende ohne abgeschwächte Deckkraft, Alarm-Pill und Toolbar-Badge mit weißer Schrift. Kleine Trefferflächen in Planung und Lauf-Zeitleiste per `before:`-Pseudoelement vergrößert, Hover-Pfeile auch bei `focus-visible`, abgeschnittene Namen mit `title`. Tab-Panels des Editors mit sichtbarem Fokusring und `overscroll-contain`. Schriftgrößen auf die App-Skala (10/11 px, `text-xs`) gezogen. Bestätigungs-Buttons im Singular/Plural, Fehler-Toasts 8 s, Toasts mit Aktion 10 s.
