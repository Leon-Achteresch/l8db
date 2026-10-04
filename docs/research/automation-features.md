# Automatisierte Workflows in Datenbank-Tools – Feature-Katalog

Stand: 2026-10-03. Quellen: offizielle Doku der jeweiligen Hersteller (Links in den Rohberichten der Recherche). Markierung `[Paid]` = nur in kostenpflichtigen Editionen.

Spalte **l8db**: ✅ vorhanden · 🟡 teilweise / nur manuell · ❌ fehlt

Untersuchte Tools:
- **Desktop-Clients:** DBeaver (CE/Lite/EE/Ultimate/Team, CloudBeaver), DataGrip, Navicat, TablePlus, Beekeeper Studio, DbVisualizer, Aqua Data Studio, RazorSQL, SQLyog (SJA), HeidiSQL, Valentina Studio, Chat2DB
- **Enterprise-Tools:** Toad (Data Point, SQL Server, Oracle, Intelligence Central), dbForge Studio + DevOps Automation, SSMS/SQL Server Agent/Maintenance Plans/SSIS/Azure Elastic Jobs, pgAdmin/pgAgent, MySQL Workbench/MySQL Shell, Oracle SQL Developer/SQLcl/Database Actions, Redgate (SQL Compare, Data Compare, Monitor, Backup, Flyway, SCA), EMS SQL Studio
- **Web/BI/Workflow-Tools:** Retool Workflows, n8n, Zapier, Metabase, Redash, PopSQL, Grafana Alerting, Hex, Mode, Count.co, Outerbase, Arctype
- **Plattform/DevOps-Tools:** Supabase, Neon, PlanetScale, Bytebase, Atlas, Liquibase, Flyway, Airflow, Dagster, dbt

---

## 1. Task-/Job-Modell

| Feature | Wer hat es | l8db |
|---|---|---|
| Wizard-Konfiguration als wiederverwendbaren „Task“ speichern („Save as task“, „Save Command Line“, Profile) | DBeaver, Navicat, dbForge, Toad, SQLyog, EMS, Oracle SQL Dev (Cart) | 🟡 Export-Templates, CSV-Mapping-Presets, Analysis-Workspaces – aber nicht ausführbar als Task |
| Task-Ansicht mit Ordnern, Drag & Drop, Gruppierung nach Kategorie/Typ, konfigurierbaren Spalten | DBeaver | ❌ |
| Task nachträglich bearbeiten (Format, Objekte, Optionen) | DBeaver, Navicat, Toad | ❌ |
| Tasks als Datei im Projekt (`tasks.json`, `.tas`, XML-Jobfiles, `.scomp/.dcomp`), dadurch per Git teilbar | DBeaver, Toad, SQLyog, dbForge, Redgate, DataGrip (Run-Configs) | ❌ |
| Tasks exportieren/importieren, als Text kopieren/einfügen | EMS, Toad Oracle, Navicat (Profile-Ordner) | ❌ |
| Mehrere Tasks zu einem „Batch Job“/„Composite Task“/„App“ bündeln | DBeaver [Paid], Navicat, Toad, EMS, SQLyog | ❌ |
| Verschachtelte Composite Tasks | DBeaver, Toad (Run Automation Script) | ❌ |
| Task-Vorlagen/„Save as Template“ einzelner Aktivitäten, eigene Template-Toolbox | Toad, AquaScript-Templates | ❌ |
| „Action Recall“: die letzten N Konfigurationen pro Typ automatisch merken, „Rerun“-Menü | Toad Oracle | ❌ |
| Tasks aus jedem Fenster per Kamera-Button speichern/planen | Toad Oracle | ❌ |
| Task auf Toolbar / im Project Manager ablegen | Toad Oracle | ❌ |
| Task aktivieren/deaktivieren ohne zu löschen | SQL Agent, pgAgent, Toad (2024 R2), Supabase Cron, Neon Triggers | ❌ |
| Bulk-Bearbeitung von Task-Eigenschaften | Toad 2024 R2, SSMS Job Activity Monitor | ❌ |
| „Change connections…“ für mehrere Aktionen auf einmal | Toad Oracle | ❌ |
| Suche über alle Tasks inkl. Eigenschaftswerte (Regex) | Toad 2025 R2 | ❌ |
| Automatische Backups von Task-Definitionen | Toad 2026 R1 | ❌ |
| Grafischer Workflow-Designer (Canvas mit Knoten, Verbindungen) | Toad, Retool, n8n, Oracle Scheduler Design Editor, SSMS Maintenance Plan Designer | ❌ |
| „Print Script“ – Workflow-Diagramm drucken | Toad | ❌ |
| Validierungs-Icon bei fehlenden Inputs/undefinierten Variablen | Toad | ❌ |
| README/Beschreibung pro Workflow (Markdown) | Retool, SQL Agent (512 Zeichen) | ❌ |
| Job-Kategorie/Klasse (nur zur Gruppierung) | SQL Agent, pgAgent, Oracle Job Class | ❌ |
| Test- und Produktions-Umgebung pro Script (eigene Connection + Root-Pfad) | Toad, Retool Environments, dbt Environments | ❌ |

## 2. Task-Typen / Aktivitäten

| Aktivität | Wer hat es | l8db (manuell vorhanden?) |
|---|---|---|
| SQL-Script ausführen (mehrere Scripts in Reihenfolge, gegen mehrere Connections) | alle | 🟡 Script-Runner manuell |
| Query → Datei (CSV/XLSX/HTML/JSON/…) | alle | 🟡 Export manuell |
| Query → Editor-Datei mit Ergebnissen | Toad | ❌ |
| Query-Ergebnis in Variable speichern | Toad, n8n, Retool | ❌ |
| Import (CSV/XLSX/JSON/ODBC/DBF/…) | DBeaver, Navicat, Toad, dbForge, SQLyog, DbVis, Beekeeper | 🟡 manuell |
| Data Transfer / Migration zwischen Datenbanken | DBeaver, Navicat, Valentina, SQL Dev, MySQL WB | 🟡 Transfer manuell |
| Data Compare + Sync-Script (+ optional ausführen) | DBeaver, Navicat, Toad, dbForge, Redgate, SQLyog, EMS | 🟡 manuell |
| Schema Compare + Sync-Script (+ optional ausführen, Report) | DBeaver, Toad, dbForge, Redgate, pgAdmin, SQLyog, Valentina | 🟡 manuell |
| Backup / Restore (native Tools) | DBeaver, Navicat, dbForge, pgAdmin, SQLyog, Beekeeper, SQL Backup Pro | 🟡 manuell |
| Testdaten generieren | DBeaver [Paid], Navicat, dbForge, Redgate, EMS | 🟡 manuell |
| Datenbank-Dokumentation generieren (HTML/PDF/Markdown) | dbForge, Redgate SQL Doc, Navicat (Data Dictionary), Toad (HTML Schema Doc), Liquibase db-doc | ❌ |
| Report ausführen und exportieren (PDF/HTML/XLSX/Bilder) | Toad, dbForge Data Report, Navicat BI, Grafana Reporting, Metabase | ❌ |
| Pivot-Grid / Chart refreshen und exportieren | Toad (Pivot Grid, Visualize Data) | ❌ |
| Datenprofiling / Data Cleansing | Toad Data Point | ❌ |
| Snapshot refreshen | Toad | ❌ |
| Schema-Snapshot erstellen | dbForge Oracle, Redgate, Neon | 🟡 Branching-Snapshots |
| Liquibase-Changelog erzeugen | DBeaver | ❌ |
| SQL formatieren (Dateien/Ordner) | dbForge, SQL Dev `sdcli format` | ❌ |
| Ungültige Objekte finden | dbForge, Flyway Enterprise | ❌ |
| Code-Analyse / SQL-Lint mit Report | Toad (Code Analysis), Flyway check -code, Bytebase SQL Review, Atlas lint | ❌ |
| Index-Wartung (Rebuild/Reorganize nach Schwellwert) | dbForge Index Manager, SSMS Maintenance Plans | ❌ |
| Wartung: VACUUM/ANALYZE/REINDEX/CLUSTER, CHECKDB, Statistiken | pgAdmin, SSMS, DBeaver (DB-spezifisch), SQLyog | ❌ |
| History-/Log-Cleanup | SSMS Maintenance Plan | ❌ |
| Unit-Tests ausführen (tSQLt, utPLSQL) | dbForge, Redgate SCA, SQL Dev | ❌ |
| Shell-Kommando / Programm ausführen (mit Argumenten, Arbeitsverzeichnis, Wait-Timeout, Return-Code) | DBeaver, Toad, SQL Agent CmdExec/PowerShell, Aqua, RazorSQL | ❌ |
| Datei-Operationen: kopieren, verschieben, löschen, umbenennen, Ordner anlegen/löschen | Toad | ❌ |
| „File exists“-Prüfung | Toad Oracle | ❌ |
| Zip/Unzip (Passwort, AES-128/256) | Toad, Aqua FluidShell | ❌ |
| Suchen & Ersetzen in Dateien (Wert, Dateiinhalt oder Variable) | Toad | ❌ |
| FTP/SFTP Upload/Download (Dateimasken, Retry, „nur übertragen wenn…“) | Toad, dbForge Data Report, AquaScript | ❌ |
| SCP/SSH-Remote-Kommando | AquaScript, FluidShell | ❌ |
| E-Mail senden (Anhänge mit Wildcards, HTML-Body aus Datei) | Toad, DbVis `@mail`, Aqua `.sendMail`, SQLyog | ❌ |
| Log-Kommentar ins Run-Log schreiben | Toad, DbVis `@echo`/`@log` | ❌ |
| Pause / Sleep N Sekunden | Toad, DbVis `@sleep`, Retool Wait (bis 60 Tage), n8n Wait | ❌ |
| Ping / TNS-Ping / Service prüfen | Toad Oracle | ❌ |
| Anderen Task/Job starten (sync oder fire-and-forget) | Toad, SQL Agent, Retool, n8n, Navicat | ❌ |
| HTTP-Request / Webhook aufrufen | Supabase Cron, Retool, n8n, AquaScript `aqua.net` | ❌ |
| Datei auf Intelligence Central/Server publizieren | Toad TIC | ❌ |
| In Cloud-Storage (S3/Azure/GCS) ablegen | DBeaver [Ultimate], Hex, SQL Backup Pro | ❌ (S3-Feature existiert, nicht als Ziel) |
| In Google Sheets exportieren | Hex, dbForge, PopSQL | ❌ |
| Writeback (Ergebnis in Tabelle schreiben: overwrite/append) | Hex | ❌ |
| Human-in-the-loop: Freigabe-Schritt im Workflow (approve/reject, Auswahl, Freitext) | Airflow HITL, Retool User Task | ❌ |
| KI-Agent als Schritt (Prompt, Ergebnis/Run-State) | Retool Invoke Agent, Hex Tasks | ❌ |
| Datenbankspezifische Aufgaben (Tabellenwartung, Trigger aktivieren/deaktivieren) | DBeaver | ❌ |
| Mongo: Dump/Import/Export/MapReduce/Aggregation | Navicat | 🟡 Backup |
| Model/ERD-Export, Data-Dictionary-PDF | Navicat | ❌ |

## 3. Trigger & Zeitpläne

| Feature | Wer hat es | l8db |
|---|---|---|
| Manuell starten (Run now) | alle | ✅ Tools manuell, DB-Scheduler-Jobs „run now“ |
| Einmalig zu Zeitpunkt | SQL Agent, Oracle, Navicat, Aqua, Bytebase Scheduled Rollout | ❌ |
| Intervall (alle N Sekunden/Minuten/Stunden/Tage) | fast alle | 🟡 nur Auto-Refresh, Snapshot-Scheduler (nicht aktiviert) |
| Täglich / wöchentlich (Wochentage-Bitmaske) / monatlich (Tag X) | SQL Agent, Navicat, EMS, Aqua, pgAgent | ❌ |
| Monatlich relativ („erster/letzter Montag“, „letzter Tag des Monats“) | SQL Agent, EMS, Grafana Reporting, pgAgent „Last Day“ | ❌ |
| Jährlich | EMS | ❌ |
| Cron-Ausdruck (5-Feld, 6-Feld mit Sekunden, Quartz 7-Feld, `L`) | DBeaver (cron), Metabase, n8n, Supabase, SQLcl, dbt, Count, Hex | ❌ |
| Cron mit lesbarer Vorschau / Tooltips | Retool, SQL Dev Repeat-Interval-Builder | ❌ |
| Natürliche Sprache → Cron (KI) | Supabase | ❌ |
| Mehrere Zeitpläne pro Job; ein Zeitplan für mehrere Jobs (shared schedules) | SQL Agent, Retool, PopSQL | ❌ |
| Mehrere Startzeiten pro Tag | EMS | ❌ |
| Sub-Day-Intervall innerhalb eines Zeitfensters (z. B. alle 10 min zwischen 8–18 Uhr) | SQL Agent | ❌ |
| Start-/Enddatum, Enddatum „nie“ / nach N Läufen / an Datum | SQL Agent, EMS, Redash, Grafana, pgAgent | ❌ |
| Ausnahmen (bestimmte Daten/Uhrzeiten ausschließen, Feiertage) | pgAgent Exceptions, Dagster Partition-Exclusions | ❌ |
| „Nur Mo–Fr“ | Zapier, Grafana Reporting | ❌ |
| Zeitzone pro Zeitplan | Retool, n8n, Airflow, Dagster, Mode, Grafana | ❌ |
| Jitter bei Cron-Läufen | Retool | ❌ |
| Beim Start des Agents/der App | SQL Agent, Task Scheduler (At startup/logon) | ❌ |
| Wenn CPU idle | SQL Agent | ❌ |
| Bei Windows-Event | Task Scheduler (dbForge) | ❌ |
| Datei-Watcher (Datei erscheint, Mindestgröße, steady-state-Dauer, Wildcards) | Oracle File Watcher, Neon Storage Trigger | ❌ |
| Queue-/Event-Trigger (SQS, Kafka, Pub/Sub, pgmq, Oracle AQ) | Retool, Airflow, Oracle Scheduler | ❌ |
| Datenbank-Trigger: Insert/Update/Delete auf Tabelle, LISTEN/NOTIFY | n8n Postgres Trigger, Supabase Webhooks, Zapier (Polling) | ❌ |
| Polling auf neue/geänderte Zeilen (Deduplizierung über PK) | Zapier, n8n | ❌ |
| SQL-Sensor: warten bis Query Wert liefert (poke interval, timeout, backoff, soft fail) | Airflow SqlSensor | ❌ |
| Webhook-URL (mit API-Key, Pfadparametern, JSON-Body, cURL-Kopie) | Retool, n8n | ❌ |
| „Nach Job X“ (bei Erfolg/Fehler/Abbruch) | dbt, Dagster Run-Status-Sensor | ❌ |
| Asset-/Daten-getrieben (läuft, wenn Upstream aktualisiert) | Airflow Assets, Dagster Declarative Automation | ❌ |
| Alert löst Job aus | SQL Agent Alert → Job | ❌ |
| Bei Connection-Events (vor/nach Connect/Disconnect) | DBeaver Shell-Hooks, DbVis SQL on connect, TablePlus Bootstrap | ❌ |
| Bei App-/Plattform-Events (Login, User angelegt, Deploy fertig) | Retool Events | ❌ |
| Bei PR / Merge (CI-Job) | dbt, Bytebase, Atlas, Neon, PlanetScale | 🟡 `--check` für CI |
| Pausieren/Fortsetzen eines Zeitplans | EMS, Grafana Reporting, Airflow | ❌ |
| Verpasste Läufe nachholen (Don't run / Run most recent / Catch-up, Grace Period) | n8n Durable Scheduler, Azure Elastic Jobs | ❌ |
| Überlappende Läufe verhindern (nächster wartet, ältere Queue-Läufe abbrechen) | Retool, dbt | ❌ |
| Backfill über Zeitraum (nur fehlende/fehlgeschlagene/alle neu) | Airflow, Dagster | ❌ |
| Läuft auch wenn App geschlossen (OS-Scheduler, Dienst, Server-Daemon) | DBeaver, Navicat, Toad, SQLyog, Aqua, EMS-Dienst, SQLcl-Daemon | ❌ |
| „Run whether user is logged on or not“, aus Standby aufwecken | Navicat, Toad (Task Scheduler) | ❌ |
| Planungsübersicht: State, Last Run, Next Run, Last Result | EMS, SSMS Job Activity Monitor, Hex Admin | ❌ |
| Forecast (wann laufen Jobs als Nächstes) | Oracle Database Actions | ❌ |

## 4. Ablaufsteuerung

| Feature | Wer hat es | l8db |
|---|---|---|
| Sequenzielle Schritte, umsortierbar | alle mit Composite/Batch | ❌ |
| On-Success / On-Failure → nächster Schritt, Schritt N, Ende mit Erfolg/Fehler | SQL Agent, EMS, SSMS Maintenance Plans | ❌ |
| Startschritt wählen / ab Schritt X ausführen | SQL Agent, Toad Oracle | ❌ |
| If / Else-If / Else, Switch mit Fallback | Toad, Retool, n8n | ❌ |
| Branch basierend auf SQL-Ergebnis (true/false) | Airflow BranchSQLOperator | ❌ |
| Precedence Constraints (Success/Failure/Completion + Ausdruck, AND/OR) | SSMS Maintenance Plans | ❌ |
| Trigger Rules (all_success, one_failed, none_failed, always …) | Airflow | ❌ |
| Schleife über Ergebniszeilen einer Query (Spalten als Variablen) | Toad Loop Dataset / Query Iterator | ❌ |
| Schleife über Connections (gleiche Aktion gegen viele DBs) | Toad Loop Connections, DBeaver SQL-Script-Task, Aqua „Run against every server“ | 🟡 Script manuell je Connection |
| Schleife über Dateien/Ordner/Liste | Toad File/Folder/List Iterator | ❌ |
| While / Repeat-Until mit Max-Iterationen | Toad | ❌ |
| Loop-Modi parallel / sequenziell mit Delay / Batch mit Batch-Größe | Retool | ❌ |
| Parallele Zweige (mit Cancel- und Fault-Handler) | Toad Parallel | ❌ |
| Max. parallele Threads (z. B. Export vieler Tabellen) | DBeaver, Navicat | ❌ |
| Filter / Remove Duplicates / Merge-Join zweier Datenquellen / Compare Datasets | n8n | ❌ |
| Sub-Workflow aufrufen (warten oder fire-and-forget, typisierte Inputs) | n8n, Retool, Zapier | ❌ |
| Funktionen innerhalb eines Workflows (Blöcke zu Funktion zusammenfassen) | Retool | ❌ |
| Gruppen von Aktivitäten | Toad Group, Airflow TaskGroups | ❌ |
| Setup/Teardown-Schritte (Teardown läuft auch bei Fehler) | Airflow | ❌ |
| Script-intern: `@stop on error/norows/sqlwarning`, `@continue on …` | DbVisualizer | ❌ |
| Script-intern: `@set dryrun`, `@commit`, `@rollback`, `@set autocommit` | DbVisualizer | ❌ |
| Script-intern: `@include`, `@run file`, `:r file`, `source` | DBeaver, DbVis, SSMS SQLCMD | ❌ |
| SQLCMD-Mode (`:setvar`, `:connect`, `:on error`, `:out`, `!!` Shell) | SSMS | ❌ |
| `@export`/`@import`/`@mail` als Script-Befehle | DbVisualizer, DBeaver `@export` | ❌ |
| `REPEAT n sleep`, `background`-Jobs in CLI | SQLcl | ❌ |

## 5. Fehlerbehandlung, Retries, Timeouts

| Feature | Wer hat es | l8db |
|---|---|---|
| Stop on error vs. continue on error (global und pro Schritt) | alle | 🟡 nur in einzelnen Tools |
| „Ignore task error“ pro Composite-Schritt | DBeaver | ❌ |
| „Generate Error“-Checkbox (Fehler eines Schritts bricht Script nicht ab) | Toad | ❌ |
| Liste ignorierter Fehlercodes (z. B. ORA-xxxx) | Toad Oracle | ❌ |
| Warnings als Fehler behandeln | dbForge `/treatwarningaserror`, dbt `--warn-error` | ❌ |
| Abort on warnings (None/Medium/High) | Redgate SQL Compare | ❌ |
| Retry-Anzahl + Intervall pro Schritt | SQL Agent, Toad (Copy/FTP), Retool, n8n | ❌ |
| Exponential Backoff (Koeffizient, Max-Intervall, Jitter) | Retool, Airflow, Dagster, Azure Elastic Jobs | ❌ |
| Automatisches Replay fehlgeschlagener Läufe (z. B. +5 min, +30 min, +1 h …) | Zapier Autoreplay | ❌ |
| Backoff bei wiederholten Fehlern (2^n Minuten) | Redash | ❌ |
| „Fail ohne Retry“ für permanente Fehler | Airflow, Dagster | ❌ |
| Rerun from failure / ab fehlgeschlagenem Schritt | dbt, Dagster, n8n, Zapier | ❌ |
| Fehlerhafte Zeilen in Datei sammeln und später erneut importieren | DbVisualizer `errorRecords.drec` | ❌ |
| Globaler Error-Handler / Error-Workflow mit Fehlerkontext | Retool, n8n | ❌ |
| Fehlerbehandlung pro Block mit eigenem Error-Ausgang | Retool, n8n, Zapier | ❌ |
| Throw Error (eigene Fehlermeldung, eigener Exit-Code) | Toad (555), n8n Stop And Error | ❌ |
| Timeout pro Task (Presets 1/5/30 min, 1 h, custom) | DBeaver | ❌ |
| Timeout pro Schritt / Run-Timeout / Max-Laufzeit | SQL Agent, Retool, n8n, Airflow, Dagster, dbt, Oracle | ❌ |
| Timeout-Aktion (was passiert bei Timeout) | EMS | ❌ |
| Deadline-Alerts (Warnung, wenn Lauf bis X nicht fertig, auch relativ zur Durchschnittslaufzeit) | Airflow | ❌ |
| Job automatisch deaktivieren nach N Fehlern in Folge | dbt (100), Airflow, Zapier (95 % in 7 Tagen), Redash, Retool | ❌ |
| Max Runs / Max Failures pro Job | Oracle Scheduler | ❌ |
| Transaktion pro Script / pro Datei / Single Transaction / Commit alle N Zeilen | DBeaver, Navicat, Aqua, Atlas, Flyway, Bytebase | 🟡 Transaktionsmodus manuell |
| Automatisches Rollback bei Fehler, Rollback nach Inaktivität | Navicat Sync, Beekeeper (10 min), Liquibase `--rollback-on-error` | 🟡 |
| Backup des Ziels vor Sync (`/MakeBackup`, `/backup`) | Redgate, dbForge | ❌ |
| Prior Backup für DML-Rollback (betroffene Zeilen sichern) | Bytebase | ❌ |
| Zombie-/hängende Läufe erkennen und abbrechen | Airflow, Dagster Run Monitoring | 🟡 Tasks „interrupted“ nach Neustart |
| Exit-Code-Check zwischen Schritten (Sync nur bei „unterschiedlich“) | dbForge (100/101), Redgate (63/79) | ❌ |

## 6. Variablen, Parameter, Platzhalter

| Feature | Wer hat es | l8db |
|---|---|---|
| Task-Variablen mit Default-Wert | DBeaver, Toad, DbVis, Aqua | 🟡 Notebook-Variablen |
| „Variablen vor Ausführung abfragen“ (Prompt); bei geplanten Läufen Default verwenden | DBeaver, Toad, DbVis | 🟡 Bind-Params-Dialog |
| Variablen per CLI überschreiben (`-var`, `-vars file.properties`) | DBeaver, Toad Parameter-File (INI) | ❌ |
| Typisierte Variablen (String, Number, Date, DateTime, SQL-Dataset, Boolean, Choices/Dropdown) | Toad, DbVis, Airflow Params, PopSQL, Metabase | 🟡 |
| SQL-Variable: Wert aus Query-Ergebnis (`var.column`, erste Zeile/Spalte) | Toad | ❌ |
| Set Variable Value (Zähler `var = var + 1`), Expression Builder | Toad | ❌ |
| Variablen-Scope (global/lokal, je Verschachtelungsebene) | Toad | ❌ |
| Built-in-Variablen: `${date}`, `${time}`, `${timestamp}`, `${database}`, `${host}`, `${user}`, `${project}`, Job-Name, Step-Name, Run-ID | DBeaver, SQL Agent Tokens, Flyway, dbt | ❌ |
| Row-Count / Return-Code / Fehlertext des letzten Schritts als Variable | Toad (`#File_1_RCOUNT#`, `_ACTIVITY_RESULT`), DbVis `{{dbvis-last.*}}` | ❌ |
| Relative Datumsausdrücke (`{d-1y}`, `{dt-2h}`) | Aqua, Mode (Liquid) | ❌ |
| Datumsformat-Tokens und Funktionen (To_char, Extract, Current_date) | Toad | ❌ |
| Umgebungsvariablen / Secrets (verschlüsselt, maskiert in Logs) | dbt `DBT_ENV_SECRET_`, Retool, n8n, Airflow Secrets Backend | 🟡 Keychain für Connections |
| Variablen in Connection-Feldern | DbVisualizer | ❌ |
| Platzhalter-Syntaxen konfigurierbar (`?1`, `:name`, `${x}`, `&name`, `#x#`) per Regex | DataGrip | 🟡 Snippets `${name:default}` |
| Liquid-/Jinja-Templating in SQL (`{% if %}`) | PopSQL, Mode, dbt | ❌ |
| Parameterwerte pro Zeitplan (gleiche Query, versch. Parameter-Sets) | PopSQL, Mode, Hex (saved views), Metabase | ❌ |
| Escape-Makros für Tokens (`$(ESCAPE_SQUOTE(...))`) | SQL Agent | ❌ |
| Positionsparameter `&1`, `&2` an Scripts | Toad Oracle | ❌ |
| Parameter-Datei (INI) mit Property-Overrides | Toad Oracle | ❌ |
| Trigger-Formular aus JSON-Schema generiert (Sections, Dropdowns, Datumsfelder) | Airflow Params | ❌ |

## 7. Ausgabe: Formate, Dateinamen, Kompression, Ziele

| Feature | Wer hat es | l8db |
|---|---|---|
| Formate CSV, TSV, XLSX, XLS, JSON, JSONL, XML, HTML, Markdown, SQL-INSERT, TXT, Parquet, PDF, RTF, DBF, Access, ODBC, Google Sheets, PNG/Bilder | DBeaver, dbForge (14 Formate), Navicat, Toad, DbVis | 🟡 CSV/XLSX u. a. |
| Dateinamen-Pattern mit Variablen (`${table}_${timestamp}`, `<DATETIME fmt>`) | DBeaver, SQL Backup Pro, SQLyog | ❌ |
| „Append timestamp“-Checkbox, eigenes Timestampformat | dbForge, Navicat, Aqua | ❌ |
| Alte Dateien automatisch löschen (nach Alter in Tagen oder Anzahl) | dbForge, SQL Backup Pro ERASEFILES, SSMS Maintenance Cleanup | ❌ |
| Datei existiert: fragen / anhängen / umbenennen / überschreiben | DBeaver, Navicat, Toad | ❌ |
| Alles in eine Datei vs. eine Datei pro Tabelle/Objekt | DBeaver, Navicat, DbVis, SQLyog | 🟡 |
| Datei splitten ab Größe (z. B. 10 MB) | DBeaver, DbVis | ❌ |
| Excel: Sheet-Name, an Sheet anhängen, Startzelle, ein Sheet pro Statement, Timestamp im Sheetnamen | Toad, DbVis | ❌ |
| ZIP-Kompression (Level, Kommentar, AES-128/256-Passwort) | dbForge, DBeaver, SQLyog, Toad | ❌ |
| Backup-Verschlüsselung, Compression-Level | pgAdmin, SSMS, SQL Backup Pro, Navicat (Oracle Data Pump) | 🟡 je nach Tool |
| Encoding, BOM, Werteformat (Datum/Zahl/NULL-Text/Boolean) | DBeaver, Navicat, DbVis | 🟡 |
| BLOB/CLOB in separate Dateien | DbVisualizer | ❌ |
| Ausgabe in Zwischenablage | DBeaver, DbVis, Redgate | ✅ (Grid-Copy) |
| Ziel: Cloud-Storage (S3/Azure/GCS), Cloud-synced Folder | DBeaver [Paid], SQL Backup Pro COPYTO_HOSTED | ❌ |
| Ziel: FTP/SFTP | Toad, dbForge Data Report | ❌ |
| Ziel: Netzwerkkopie mit Retry (bis 24 h Queue) | SQL Backup Pro | ❌ |
| Ziel: Tabelle in anderer DB (Output-Table) | dbForge, Azure Elastic Jobs | 🟡 Transfer |
| Report-Dateien (Diff-Report HTML/XLS/XML, Drift-Report HTML/JSON) | Redgate, dbForge, Flyway, Liquibase | 🟡 Compare-UI |
| Öffentlicher CSV-Link (z. B. für Google Sheets IMPORTDATA) | PopSQL, Metabase Public Links | ❌ |

## 8. Benachrichtigungen

| Feature | Wer hat es | l8db |
|---|---|---|
| E-Mail bei Erfolg / bei Fehler / immer (getrennt wählbar) | Navicat, DBeaver [Paid], SQLyog, EMS, Toad, SQL Agent | ❌ |
| Log-Datei / Ergebnisdateien als Anhang, „nicht senden wenn leer“, „keine Dateien anhängen“ | DBeaver, Navicat, Toad | ❌ |
| SMTP-Profile (Host, Port, TLS/SSL, Auth, Test-Mail), Failover-Accounts | DBeaver, Navicat, DbVis, SQL Database Mail | ❌ |
| Betreff-/Body-Templates mit Makros (`#START`, `#STOP`, `#RESULT`, `{{dbvis-last.statusCode}}`) | EMS, DbVis, Redash, Grafana | ❌ |
| Native Desktop-Benachrichtigung (OS-Notification, Sound, Close-Delay) | DBeaver | ❌ (nur In-App-Toasts) |
| „Lange Query“-Benachrichtigung (> 20 s) | DataGrip | ❌ |
| Slack, Microsoft Teams, Discord, Google Chat, Mattermost, Webex, Telegram, DingTalk, Feishu, WeCom | Metabase, Redash, Grafana, Bytebase, Hex, Mode, PopSQL, Count | ❌ |
| PagerDuty, Opsgenie, VictorOps, Grafana OnCall, ServiceNow, Jira, Asana, Datadog-Event | Redash, Grafana, Redgate Monitor | ❌ |
| SMS/Pushover/SNMP/MQTT/Kafka/AWS SNS | Grafana, Redgate Monitor | ❌ |
| Generischer Webhook (Auth: Basic/Bearer/API-Key, JSON-Payload inkl. Base64-Chart, HMAC-Signatur) | Metabase, Redash, PlanetScale, dbt, Grafana | ❌ |
| Ergebnis als Tabelle/Chart-Bild/CSV/PDF im Chat-Post | PopSQL, Hex, Count, Metabase | ❌ |
| Benachrichtigungs-Frequenz: sofort, sofort+stündliche Zusammenfassung, nur stündlich, nie | Zapier | ❌ |
| Fehler-Mails aggregieren (z. B. alle 60 min), Limit pro Query | Redash | ❌ |
| Fehler-Mail erst nach letztem Retry | Zapier | ❌ |
| Fail-safe-Operator, Bereitschaftszeiten (Pager on-duty) | SQL Agent | ❌ |
| Delay zwischen Responses (Spam-Schutz) | SQL Agent | ❌ |
| Abonnenten selbst abmelden, Admin-Bulk-Verwaltung aller Abos | Metabase, Mode | ❌ |
| Domain-Allowlist für Empfänger | Metabase | ❌ |
| Event-Log (Windows) als Ziel | SQL Agent, EMS | ❌ |

## 9. Alerts, Bedingungen, Datenqualität, Monitoring

| Feature | Wer hat es | l8db |
|---|---|---|
| Alert „Query liefert Ergebnisse“ / „liefert keine Ergebnisse“ / „Query-Fehler“ | Metabase, Count, PopSQL | ❌ |
| Schwellwert-Alert auf Wert (>, >=, <, <=, ==, !=; erste Zeile / Min / Max) | Redash, Hex, Grafana | ❌ |
| Zeitreihe kreuzt Ziel-Linie (über/unter, nur erstes Mal oder jedes Mal) | Metabase | ❌ |
| Progress-Bar erreicht Ziel | Metabase | ❌ |
| Row-Count-Bedingung auf Tabelle | Hex | ❌ |
| Multi-dimensionale Alerts (jede Ergebniszeile = eigene Alert-Instanz) | Grafana | ❌ |
| Alert-Zustände (OK / Triggered / Unknown; Normal/Pending/Alerting/Recovering/NoData/Error) | Redash, Grafana | ❌ |
| Pending-Periode, Recovery-Schwelle gegen Flapping, „keep firing for“ | Grafana | ❌ |
| „Nur einmal senden“ / jedes Mal / höchstens alle N | Metabase, Redash | ❌ |
| Mute/Snooze, Silences, Mute-Timings (Zeitfenster, Wochentage), Wartungsfenster | Redash, Grafana, Redgate Monitor | ❌ |
| Benachrichtigungs-Routing (Policy-Tree, Label-Matcher, Gruppierung, Repeat-Intervall) | Grafana | ❌ |
| Performance-Counter-Alert (`object|counter|instance` > Wert) | SQL Agent | ❌ |
| Fehler-/Severity-Alert (Fehlernummer, Severity 1–25, Keyword-Filter) | SQL Agent | ❌ |
| WMI-/DDL-Event-Alert | SQL Agent | ❌ |
| Custom Metric (T-SQL liefert Zahl, Sammelintervall, Schwellwert über Dauer) | Redgate Monitor | ❌ |
| Vorkonfigurierte Ops-Alerts: Backup überfällig, Blocking, Deadlock, lange Query, Disk Space, DB nicht erreichbar, Job-Fehler, Replikationslag, Index-Fragmentierung | Redgate Monitor | 🟡 Monitor-View ohne Alerts |
| Anomalie-Erkennung (Latenz-Perzentil-Baseline), Schema-Empfehlungen (Index, ID-Exhaustion, ungenutzte Tabellen) | PlanetScale Insights, Supabase Advisors | 🟡 Workload-Baseline-Vergleich |
| Datenqualitäts-Checks: not_null, unique, accepted_values, relationships, Min/Max, Distinct | dbt, Airflow SQLColumnCheck | ❌ |
| Value-Check mit Toleranz, Threshold-Check (Grenzen als Zahl oder Query), Intervall-Check (heute vs. vor 7 Tagen) | Airflow | ❌ |
| Fehler-Zeilen eines Checks speichern (Audit-Schema) | dbt `store_failures` | ❌ |
| Severity warn/error mit Schwellen (`error_if: >10`) | dbt | ❌ |
| Freshness: `warn_after` / `error_after` auf loaded_at-Spalte | dbt, Dagster | ❌ |
| Blocking Checks (stoppen nachgelagerte Schritte) | Dagster | ❌ |
| Drift-Erkennung (Live-Schema vs. erwarteter Stand, regelmäßiger Scan) | Bytebase, Atlas, Flyway, Liquibase | 🟡 Schema-Compare manuell |
| Policy-Based Management (Bedingungen auf Server-Facets, on change prevent/log, on schedule) | SSMS | ❌ |
| Monitor-Queries mit Auto-Reload, Zeilen-Historie, Row-Count-Diff | DbVisualizer Monitors | 🟡 Dashboards mit refreshSec |
| Dashboard-Auto-Refresh, Refresh bei Event | TablePlus Metrics Board, Redash, Arctype | ✅ |
| Monitore beim Start automatisch starten | DbVisualizer | ❌ |
| Benchmark-Grenzwert (Median ms) | – | ✅ `--benchmark --max-median-ms` |
| CI-Checks (Skalar-Gleichheit, Plan-Kosten, Seq-Scan) mit Exit-Code | – | ✅ `--check` |

## 10. Run-Historie, Logs, Statistiken

| Feature | Wer hat es | l8db |
|---|---|---|
| Liste vergangener Läufe pro Task mit Status, Start, Ende, Dauer | DBeaver, SSMS, pgAgent, EMS, Retool, n8n, dbt | 🟡 Task-Center (6 h) |
| Detail-Log pro Lauf (Output, Fehler, Warnungen), Hyperlinks zu erzeugten Dateien | DBeaver, Toad, Navicat Message Log | 🟡 |
| Pro-Schritt-Status und -Dauer | SQL Agent, Retool, dbt | ❌ |
| Log-Level (Standard/Verbose; None…Verbose) | Toad, Redgate, SQLcl | ❌ |
| Log truncate / Log-Größenlimit / History-Limit (Zeilen gesamt, pro Job) | Toad, EMS, SQL Agent | ❌ |
| Retention (z. B. 30/90/365 Tage), Auto-Purge | Retool, Hex, dbt, Azure Elastic Jobs | ❌ |
| Filter nach Zeit, Status, Trigger-Typ, Job, Commit-SHA | Retool, n8n, dbt, Zapier | ❌ |
| Export der Historie (CSV/JSON) | Zapier, Retool | ❌ |
| Run-Statistiken: Erfolgsrate, häufigste Fehler, Problem-Workflows, Durchschnittslaufzeit | Retool Analytics, Dagster Insights | ❌ |
| Gantt/Timeline der Schritte, Critical Path, Concurrency | dbt Model Timing, Airflow Gantt, Oracle Database Actions | ❌ |
| Debug: vergangenen Lauf mit seinen Daten in den Editor laden | n8n | ❌ |
| Lauf mit Original- oder aktueller Definition erneut ausführen | n8n | ❌ |
| Benutzerdefinierte Execution-Daten (Key-Value an Lauf heften) | n8n | ❌ |
| Ergebnis-Snapshots pro Lauf in Versionshistorie | Count, Hex | ❌ |
| Artefakte pro Lauf (manifest, run_results) | dbt | ❌ |

## 11. Headless / CLI / OS-Integration

| Feature | Wer hat es | l8db |
|---|---|---|
| Task headless per CLI starten (`-runTask`, `-batchjob`, `-batch=true`, `-a "App->Action"`, `sja job.xml`) | DBeaver, Navicat, Toad, SQLyog | ❌ |
| Eigenständiges CLI für Export/Import/Compare/Backup/Execute | dbForge, Redgate, RazorSQL, DbVis `dbviscmd`, EMS Console-Utilities, SQLcl, MySQL Shell | 🟡 nur `--check`, `--benchmark`, `--mcp` |
| Dokumentierte Exit-Codes (z. B. 0 ok, 100 identisch, 101 unterschiedlich, 40 Connect-Fehler) | dbForge, Redgate, DbVis, DBeaver, Toad | 🟡 `--check` |
| „Generate command line“ / „Copy as command“ aus dem GUI | dbForge, DbVis, Toad 2025 R2, RazorSQL, MySQL Enterprise Backup | ❌ |
| `.bat`/Shell-Datei erzeugen (Echo off, Pause, PowerShell-Prefix, Validate) | dbForge | ❌ |
| Argumente aus Datei (`/argfile`, XML) | dbForge, Redgate | ❌ |
| Eintrag direkt in Windows Task Scheduler / cron / launchd anlegen und entfernen | DBeaver, Navicat, Toad, SQLyog, Aqua | ❌ |
| Eigener Scheduler-Dienst/Daemon (läuft ohne GUI) | EMS, SQLcl `-daemon`, pgAgent, DBeaver Team Server | ❌ |
| Master-Passwort-/Keychain-Handling für unbeaufsichtigte Läufe (Env-Var, Passwort-Datei) | DBeaver `DBEAVER_MASTER_PASSWORD` | ❌ |
| Connection-Verwaltung per CLI (list/create/modify, JSON in/out) | DataGrip 2026.2, DbVis, Chat2DB CLI, pgAdmin `dump-servers` | ❌ |
| Deep-Link/URL-Schema zum Öffnen von Connection/Tabelle/Filter | TablePlus | ❌ |
| Datei per Drag & Drop auf Connection ausführen | Navicat, DataGrip | 🟡 `.sql` öffnet Editor |
| PowerShell-Cmdlets | dbForge DevOps, Redgate SCA | ❌ |
| REST-API zum Starten von Läufen, Status, Cancel | Hex, Mode, dbt, Retool, Count | ❌ |
| MCP-Server für Agents | Flyway, Bytebase, Count, Chat2DB, DataGrip, Supabase | ✅ |

## 12. CI/CD, Migrationen, GitOps

| Feature | Wer hat es | l8db |
|---|---|---|
| Versionierte Migrationsdateien (`V1__`, `U1__`, `R__`, Timestamp-Prefix) | Flyway, Bytebase, Atlas, Liquibase | 🟡 Versioning-Releases |
| Deklarativer State-basierter Sync (Soll-Schema → ALTER) | Atlas, Bytebase SDL, Flyway Enterprise | 🟡 Schema-Compare |
| Checksums der Migrationsdateien, Konflikterkennung bei parallelen Branches | Atlas `atlas.sum`, Flyway validate | ❌ |
| Dry-Run (SQL in Datei schreiben, nichts ausführen) | Flyway, Liquibase `*-sql`, Atlas, PlanetScale | ✅ Schema-Compare-Dry-Run |
| Rollback: to tag / to date / count, Undo-Skripte, 30-min-Revert | Liquibase, Flyway, PlanetScale | 🟡 |
| Callbacks/Hooks (beforeMigrate, afterEachMigrate, afterMigrateError …) | Flyway, Atlas Pro Hooks | ❌ |
| Preconditions (tableExists, sqlCheck → HALT/CONTINUE/MARK_RAN/WARN) | Liquibase, Atlas pre-migration checks | 🟡 Schema-Compare-Precheck |
| Contexts/Labels zur Filterung | Liquibase | ❌ |
| SQL-Lint/Review mit Regelwerk (200+ Regeln, Level Error/Warning/Disabled, Inline-Suppress) | Bytebase, Atlas, Flyway, Liquibase Policy Checks | ❌ |
| Destruktive Änderungen erkennen (DROP, Typänderung, Datenverlust) | Atlas, Liquibase, PlanetScale, Redgate Warnings | 🟡 |
| Migrations-Tests (`migrate test`, Assertions) | Atlas | ❌ |
| GitHub Actions / GitLab / Azure DevOps / Jenkins / TeamCity / Bamboo-Integration | Bytebase, Atlas, Flyway, dbForge, Neon, PlanetScale | 🟡 `--check` nutzbar |
| PR-Kommentar mit Schema-Diff / Lint-Ergebnis | Neon, Atlas, Bytebase, PlanetScale | ❌ |
| Branch-Datenbank pro PR (mit TTL, Reset from parent, Anonymisierung) | Neon, Supabase, PlanetScale | 🟡 Branching lokal |
| Rollout über viele Datenbanken/Tenants in Stages (parallel, on_error, depends_on) | Atlas, Bytebase Database Groups | ❌ |
| Zeitgesteuerter Rollout pro Task | Bytebase | ❌ |
| Gated Deployment (warten auf „Apply“), Deploy-Queue | PlanetScale | 🟡 Approval |
| Online-Schema-Change (gh-ost, Throttling, Cutover) | Bytebase, PlanetScale | ❌ |
| Drift-Resolution-Scripts automatisch erzeugen | Flyway Enterprise | ❌ |
| Deployment-Dashboard über Projekte/Umgebungen | Flyway Pipelines, Atlas Cloud | ❌ |

## 13. Freigaben, Rechte, Sicherheit, Audit

| Feature | Wer hat es | l8db |
|---|---|---|
| Freigabe vor Ausführung (Approval-Flows mit Rollenkette, CEL-Bedingungen, Risiko-Level) | Bytebase, PlanetScale, Atlas Pro, Zapier Enterprise, PopSQL Schedule Approval | 🟡 Versioning: zweite Person |
| Self-Approval verbieten, Freigabe verfällt bei Änderung | Bytebase, PlanetScale | ❌ |
| Freigabe für geplante Queries (Editor braucht Admin-OK) | PopSQL | ❌ |
| Rollen für Jobs (User/Reader/Operator), nur eigene Jobs sehen | SQL Agent, DBeaver Team | ❌ |
| Proxies/Run-as-Credentials pro Schritt | SQL Agent | ❌ |
| Rechte pro Connection-Modus und SQL-Befehl (Allow/Deny/Ask) | DbVisualizer | 🟡 MCP-Exposure, Write-Flag |
| Safe Mode (Bestätigung/Passwort/Touch ID je Query-Art) | TablePlus | 🟡 |
| UPDATE/DELETE ohne WHERE blockieren | DataGrip, pg_strict | ❌ |
| Abfrage-Limits (max. Ergebnisgröße, Zeilen, Laufzeit) | Bytebase | 🟡 MCP-Limits |
| Just-in-time-Datenzugriff/Export mit Ablauf | Bytebase | ❌ |
| Masking im Export | Bytebase, Neon Anonymized Branches | 🟡 MCP-Redaction |
| Audit-Log (wer hat was wann ausgeführt) | Bytebase, PlanetScale, Metabase | 🟡 MCP-Audit-Log |
| Trusted-Commands-Whitelist für Shell-Hooks | DBeaver | ❌ |
| Secrets nie in Task-Dateien, Passwort per Parameter/Env | dbForge, DBeaver, Redgate | ✅ Keychain |

## 14. Team, Sharing, Versionierung von Workflows

| Feature | Wer hat es | l8db |
|---|---|---|
| Geteilte Tasks im Team-Projekt, serverseitige Ausführung mit Team-Credentials | DBeaver Team, CloudBeaver | ❌ |
| Workflow-Versionen (Autosave, benannte Versionen, Diff, Restore, Publish/Unpublish) | Retool, n8n, Zapier, Hex, Grafana | ❌ |
| Git-Sync von Workflows/Queries (zweiseitig) | Retool, n8n, PopSQL, Hex, Mode, Metabase | 🟡 DB-Versioning |
| Entwurf bearbeiten, während Live-Version weiterläuft | Zapier, Retool | ❌ |
| Review/Required Approval vor Publish | Hex, Zapier Enterprise | ❌ |
| Geplante Läufe nutzen immer die veröffentlichte Version | Hex | ❌ |
| Gemeinsame Ordner mit Rechten (view/edit) | Beekeeper, Navicat Cloud | ❌ |

## 15. KI-gestützte Automatisierung

| Feature | Wer hat es | l8db |
|---|---|---|
| Workflow aus natürlicher Sprache erzeugen/ändern | Retool, n8n Workflow Builder, Zapier Copilot | ❌ |
| Geplanter KI-Task (gespeicherter Prompt läuft täglich/wöchentlich, Ergebnis per Slack/Mail) | Hex Tasks, Grafana Assistant Watchers | ❌ |
| Natürliche Sprache → Cron | Supabase | ❌ |
| KI öffnet Compare/Export/Import/Migrate-Wizard vorbefüllt | DBeaver 25.3 | 🟡 AI-Agent mit Tools |
| „Ask AI“ zum Debuggen fehlgeschlagener Läufe | Retool, Zapier, Dagster, Grafana | ❌ |
| KI-Alert-Template-Generierung | Grafana | ❌ |
| MCP-Tools für Agents (query, execute, Dashboards) | Bytebase, Flyway, Count, Chat2DB, DataGrip | ✅ |
| Agent-Abfragen in Query-History, Consent-Prompt | DataGrip 2026.2 | 🟡 Approval je Write |

## 16. Datenbankseitige Scheduler verwalten

| Feature | Wer hat es | l8db |
|---|---|---|
| pg_cron-Jobs anlegen/bearbeiten/löschen (SQL, Funktion, HTTP, Edge Function) | Supabase Cron UI | 🟡 nur list/toggle/run |
| pg_cron-Run-Historie (`cron.job_run_details`) mit Dauer, Ergebnis + Cleanup-Job | Supabase | ❌ |
| pgAgent-Jobs (Steps SQL/Batch, Schedules, Exceptions, Statistics) | pgAdmin | ❌ |
| SQL Server Agent Jobs/Steps/Schedules/Alerts/Operators | SSMS | ❌ |
| Oracle DBMS_SCHEDULER: Jobs, Programs, Schedules, Chains, Windows, File Watchers, Credentials, Notifications, Design Editor | SQL Developer, Database Actions | 🟡 list/toggle/run |
| MySQL Events (`CREATE EVENT`) | Valentina, Navicat | ❌ |
| Datenbank-Webhooks (Trigger → HTTP) | Supabase | ❌ |
| Queues (pgmq) verwalten | Supabase | ❌ |
| Problem-Jobs-Übersicht (Failed, Broken, Blocked, Retry Scheduled) | Oracle Database Actions | ❌ |
| Job-History als Chart (Dauer, CPU) / Gantt | Oracle Database Actions | ❌ |

## 17. Sonstige Kleinigkeiten

| Feature | Wer hat es | l8db |
|---|---|---|
| Bootstrap-SQL bei jedem Connect (pro Connection oder DB-Typ) | TablePlus, DbVisualizer | ❌ |
| Shell-Kommandos vor/nach Connect/Disconnect (wait ms, Prozess beim Disconnect beenden) | DBeaver | ❌ |
| Favoriten-Query per Keyword expandieren | TablePlus | 🟡 Snippets mit Shortcut |
| Live-Templates / Postfix-Completion | DataGrip | 🟡 Snippets |
| Editor-Makros aufnehmen und abspielen | DataGrip | ❌ |
| Run-Configuration mit Before-Launch-Schritten (External Tool, andere Config, Disconnect) | DataGrip | ❌ |
| External Tools mit IDE-Makros | DataGrip | ❌ |
| Scripting-API (JavaScript/Groovy/Python) mit DB-, Datei-, Mail-, FTP-, Chart-Objekten | AquaScript, MySQL Workbench, SQLcl `SCRIPT`, DataGrip Extractors | 🟡 Extension-API ohne Timer |
| Query-Scheduler „alle N Sekunden, M-mal, Output in Datei“ (nur solange App offen) | RazorSQL | ❌ |
| Notebook mit Parametern ausführen (Papermill) / Notebook als geplanter Job | Azure Data Studio, Hex | 🟡 Notebooks nur manuell |
| Caching-Policies mit geplanter Vorab-Aktualisierung | Metabase, Hex, Count | ❌ |
| Flood-Protection (> 100 Items pro Poll bestätigen) | Zapier | ❌ |
| Concurrency-Limits / Pools / Prioritäten | Airflow, Dagster, Retool, n8n | ❌ |
| Snapshot-Zeitplan mit Retention (täglich/wöchentlich/monatlich, bis 35 Tage) | Neon, PlanetScale | 🟡 Backend fertig, UI nicht verdrahtet |
| Branch-Ablauf (TTL), Auto-Archivierung | Neon | ❌ |

---

## Lücken in l8db – Zusammenfassung

Bausteine, die es schon gibt: Backup/Restore, Transfer, Schema- und Data-Compare inkl. Sync-Script und Dry-Run, Export-Templates, Import-Presets, Datengenerator, Script-Runner, Notebooks, Versioning mit Approval, Task-Center mit Fortschritt und Abbruch, `--check`/`--benchmark`, MCP-Server, AI-Agent, Anzeige von pg_cron-/DBMS_SCHEDULER-Jobs.

Was quasi allen Konkurrenten gemein ist und in l8db komplett fehlt:
1. **Gespeicherte, ausführbare Tasks** aus bestehenden Wizards („Save as task“) mit Task-Liste.
2. **Scheduler**: Intervall/täglich/wöchentlich/monatlich/Cron, Zeitzone, Start/Ende, Next-Run-Anzeige; laufend auch ohne offene App (OS-Scheduler-Eintrag oder Hintergrunddienst).
3. **Headless-Ausführung** `l8db --run-task <id>` mit Exit-Codes und `--var`-Overrides.
4. **Benachrichtigungen**: native OS-Notification, E-Mail (SMTP), Slack/Teams/Webhook – getrennt für Erfolg/Fehler, mit Anhängen.
5. **Composite Tasks** mit Continue-on-error pro Schritt, Retry, Timeout.
6. **Run-Historie** pro Task mit Logs, Dauer, Status und Retention.
7. **Dateinamen-Platzhalter** (`${date}`, `${table}`, `${database}`) und Aufräumen alter Dateien.
8. **Query-Alerts** (Ergebnis vorhanden / Schwellwert / Fehler) auf Basis gespeicherter Queries.

Sofort nutzbar: Der Snapshot-Scheduler (`useSnapshotScheduler`, `vault::Schedule`) ist im Backend fertig, aber nicht verdrahtet – das ist das kleinste erste Stück.
