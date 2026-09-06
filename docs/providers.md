# Datenbank-Provider

l8db spricht über ein Provider-Muster mit vielen Datenbanken. Ein **Provider** ist ein Produkt in der Auswahl (PostgreSQL, Supabase, MariaDB, ScyllaDB, …). Jeder Provider gehört zu einer **Treiberfamilie** (`DatabaseKind`), die genau einen Rust-Adapter besitzt. Die Familie bestimmt Protokoll, Capabilities und Treiber; der Provider liefert Eingabehilfen (Placeholder, Hinweis, Host-Erkennung).

Die Registry lebt in `src-tauri/src/db/provider.rs` und ist die einzige Quelle der Wahrheit. Das Frontend lädt sie beim Start über `list_providers` (`src/lib/providers.ts`) und blendet damit Sidebar-Tabs, Tabellen-Tabs, Dashboard-Metriken, SSL/SSH-Felder und Query-Funktionen ein oder aus.

## Familien und Treiber

| Familie | Provider | Treiber | Installation |
| --- | --- | --- | --- |
| `postgres` | PostgreSQL, Supabase, Neon, CockroachDB, Redshift, Timescale, YugabyteDB, AlloyDB, Materialize, CrateDB, QuestDB, Greenplum, Cloud Postgres | `tokio-postgres` (eingebettet) | keine |
| `mysql` | MySQL, MariaDB, TiDB, PlanetScale, SingleStore, Aurora MySQL, Vitess, Doris, OceanBase | `mysql_async` (eingebettet) | keine |
| `sqlite` | SQLite, libSQL | `rusqlite` (bundled) | keine |
| `mssql` | SQL Server, Azure SQL | `tiberius` (eingebettet) | keine |
| `clickhouse` | ClickHouse | HTTP-Schnittstelle über `reqwest` | keine |
| `mongodb` | MongoDB, Atlas, DocumentDB, Cosmos DB (Mongo), FerretDB | `mongodb` (eingebettet) | keine |
| `redis` | Redis, Valkey, KeyDB, Dragonfly | `redis` (eingebettet) | keine |
| `cassandra` | Cassandra, ScyllaDB | `scylla` (eingebettet) | keine |
| `oracle` | Oracle Database | `oracle` (ODPI-C, lädt den Instant Client zur Laufzeit) | macOS ARM: offizielles ARM64-DMG nach `~/Downloads`, Libs nach `~/lib` verlinkt; Intel: `brew tap InstantClientTap/instantclient && brew trust instantclienttap/instantclient && brew install instantclient-basic`; sonst Download, siehe Hinweis im Editor |
| `duckdb` | DuckDB | `duckdb` (bundled), Cargo-Feature `duckdb` | Build mit `cargo tauri build --features duckdb` |
| `odbc` | DB2, Firebird, Informix, Sybase, HANA, Teradata, Snowflake, BigQuery, Databricks, Athena, Vertica, Exasol, Trino, Hive, Netezza, Access, generisch | `odbc-api`, Cargo-Feature `odbc` | unixODBC (`brew install unixodbc` / `apt install unixodbc`) plus Hersteller-Treiber |

Reine Rust-Treiber sind fest in die App kompiliert; nichts muss installiert werden. Oracle wird zur Laufzeit erkannt (`driver_status`) und zeigt bei fehlendem Client Installationsbefehle pro Betriebssystem. DuckDB und ODBC sind optionale Cargo-Features, damit der Standard-Build schlank bleibt; ohne Feature meldet die Registry den Treiber als nicht verfügbar und der Editor zeigt den Hinweis.

## Capabilities

`DatabaseKind::capabilities()` beschreibt pro Familie, welche Bereiche des Arbeitsplatzes gelten (Datenbanken, Schemas, Views, Funktionen, Extensions, Rollen, Sequenzen, Trigger, Indizes, RLS, Partitionen, Replikation, Sessions, Transaktionen, Zeilenbearbeitung, Explain, Übersicht, SSL-Parameter, SSH, Query-Sprache). Nicht unterstützte Trait-Methoden liefern im Backend `Err("… wird von diesem Treiber nicht unterstützt")`, das Frontend deaktiviert die zugehörigen Queries und Tabs vorab.

Zeilenbearbeitung und Transaktionen gibt es für PostgreSQL (`ctid`-basiert), Oracle (`ROWID`) sowie MySQL, SQLite und SQL Server (Primärschlüssel als JSON in `__ctid__`); Tabellen ohne Primärschlüssel und Views bleiben dort schreibgeschützt. Alle übrigen Familien zeigen Daten schreibgeschützt und führen DML direkt aus.

## URL-Formate

- Netzwerk-Datenbanken: `schema://user:passwort@host:port/datenbank?optionen` mit den Schemata aus `url_schemes()` (z. B. `mysql://`, `mssql://`, `clickhouse://`, `mongodb+srv://`, `redis://`, `oracle://host:1521/SERVICE`, `cassandra://`).
- Dateibasierte Datenbanken: absoluter Pfad, `~/pfad`, `:memory:` oder `sqlite:/pfad`. Das Frontend speichert `sqlite:/absoluter/pfad`.
- ODBC: `odbc://user:pw@host:port/db?Driver=Name&Option=Wert` wird in einen ODBC-Connection-String übersetzt.
- SSL: `sslmode=` gilt für PostgreSQL, MySQL und SQL Server. Andere Familien nutzen ihre eigenen Parameter (`tls=true`, `rediss://`, `secure=1`).
- SQL Server: `encrypt=false` verbindet ohne TLS, `encrypt=true&trust_server_certificate=true` akzeptiert selbstsignierte Zertifikate (TLS über `rustls`, damit der Handshake auch auf macOS funktioniert).
- Cassandra in Docker: Der Treiber verbindet sich nach dem ersten Kontakt mit der Adresse aus `system.local`. Container deshalb mit `-e CASSANDRA_BROADCAST_RPC_ADDRESS=127.0.0.1 -p 9042:9042` starten.
- SSH-Tunnel: PostgreSQL behält den Hostnamen und setzt `hostaddr=127.0.0.1`; alle anderen Familien bekommen Host und Port auf den lokalen Tunnel umgeschrieben.

## Neuen Provider hinzufügen

Ein neues Produkt einer vorhandenen Familie braucht nur einen Eintrag in `PROVIDERS` in `provider.rs` (id, Name, Gruppe, Familie, Port, Placeholder, Hinweis, Host-Suffixe, Treiber). Frontend und Tests laden die Liste automatisch.

Eine neue Familie:

1. `DatabaseKind`-Variante ergänzen, `capabilities()` und `url_schemes()` pflegen, Provider-Einträge anlegen.
2. Adapter-Datei `src-tauri/src/db/<familie>.rs` mit `impl DatabaseAdapter`. Pflicht sind nur `test_connection`, `list_databases`, `list_schemas`, `list_tables`, `list_columns`, `fetch_rows`, `count_rows`, `execute_query`; alles andere hat Standard-Implementierungen und wird bei Bedarf überschrieben. Helfer aus `mod.rs`: `rows_to_objects`, `split_statements`, `where_clause`, `create_table_sql`, `timed`, `unsupported`.
3. Dispatch-Arm in `create_adapter_from_string` in `mod.rs`. Verbindungen oder Clients werden über `PoolManager::shared::<T>(key, init)` pro Verbindungsschlüssel gecacht; synchrone Treiber laufen in `spawn_blocking`.
4. `DatabaseKind` im Frontend (`src/lib/db.ts`) erweitern. Weitere Frontend-Änderungen sind nicht nötig.
5. Treiber, der zur Laufzeit geladen oder als Feature gebaut wird: `Driver::RuntimeLibrary` / `Driver::CargoFeature` verwenden und in `driver_status` erkennen, damit der Editor Installationshinweise anzeigt.

## Treiber-Seite

Die Seite `/drivers` listet alle Treiberfamilien mit Status. Fehlende Treiber mit `install_command` lassen sich per `install_driver` direkt installieren (nur allowlistete Befehle, 10-Minuten-Limit). Auf macOS wird der Oracle-Tap vorher per `brew trust` freigegeben; auf ARM-Macs lädt der Installer stattdessen das offizielle ARM64-DMG (der Brew-Tap liefert nur Intel-Binaries) und verlinkt die Bibliotheken nach `~/lib`. Wird der Treiber nach erfolgreicher Installation noch nicht erkannt, weist das Ergebnis auf einen App-Neustart hin.

## Smoke-Tests

Die Unit-Tests (`cargo test --lib`) decken URL-Parsing, die Registry und SQLite in-memory ab. Der ignorierte Test `smoke_adapters_from_env` verbindet sich mit jeder Familie, für die `L8DB_SMOKE_<KIND>_URL` gesetzt ist (z. B. `L8DB_SMOKE_MYSQL_URL`, `L8DB_SMOKE_MSSQL_URL`, `L8DB_SMOKE_CASSANDRA_URL`), und prüft Verbindung, Kataloge, Zeilen und eine Abfrage:

```sh
L8DB_SMOKE_MYSQL_URL="mysql://root:pw@127.0.0.1:33306/test" \
L8DB_SMOKE_REDIS_URL="redis://127.0.0.1:36379/0" \
cargo test --lib smoke_adapters_from_env -- --ignored --nocapture
```

Passende Docker-Images: `mysql:8`, `mcr.microsoft.com/azure-sql-edge` (arm64) bzw. `mcr.microsoft.com/mssql/server` (amd64), `clickhouse/clickhouse-server`, `mongo:7`, `redis:7`, `cassandra:5`, `gvenzl/oracle-free` (benötigt lokal den Instant Client).
