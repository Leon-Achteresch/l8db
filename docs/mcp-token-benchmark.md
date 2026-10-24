# MCP-Token-Benchmark

Gemeinsame Messstelle für die Überarbeitung des MCP-Servers (Phasen 1–4). Jede Phase ergänzt hier ihre Zahlen. Die Baseline bleibt unverändert stehen.

Test: `src-tauri/src/mcp/token_benchmark.rs`, Aufruf aus `src-tauri/`:

```sh
cargo test --lib token_benchmark -- --nocapture
```

Der Test ist deterministisch, nicht `#[ignore]` und braucht keine Datenbank außer einer temporären SQLite-Datei. Er gibt die Tabellen unten als Markdown aus.

## Tokens

**Tokens sind geschätzt als Bytes/4.** Es gibt keinen echten Tokenizer. Die Schätzung ist für englischen JSON-/TSV-Text grob richtig, ersetzt aber keine Messung mit einem konkreten Modell. Bytes sind UTF-8-Bytes.

## Workload

Oberfläche:

- `tools/list`: veröffentlichte Tool-Definitionen als `{"tools": [...]}`, mit Workflows freigegeben und einer Verbindung mit `allowScripts`, also alle Tools.
- `instructions`: Text aus der `initialize`-Antwort.
- BYOK-Startkatalog: `ai::tools::Catalog::new(config, false, &[]).tools()`, also das, was der interne KI-Arbeitsbereich in Runde 1 an Tool-Definitionen schickt.
- Bytes pro Tool aus `tools/list`.

Aufgaben: feste Skripte aus Tool-Aufrufen über `Server::call_with_config`. Pro Aufgabe zählen die Bytes der JSON-Argumente plus die Bytes des Antworttexts, also das, was das Modell liest. Jeder Schritt prüft per Teilstring, ob die Antwort die nötige Information enthält („info complete“).

Ziele:

- `Shop`: echte SQLite-Datei mit 14 Tabellen (customers, orders, order_items, invoices, payments …), Fremdschlüsseln, zwei Indizes und Beispieldaten.
- `Huge`: synthetischer PostgreSQL-Katalog, direkt in den Spalten-Cache des Servers injiziert, ohne Datenbankzugriff. 50.007 Tabellen, 1.977.120 Spalten:
  - `public`: 50 Kerntabellen plus 39 Module × 50 Entitäten (`crm_customers` …) und `customer_360` mit 450 Spalten (darunter `loyalty_tier`)
  - `analytics`: 1.500 Faktentabellen (`fact_orders_daily_r01` …) und `event_wide` mit 620 Spalten
  - `archive`: 1.000 Jahrestabellen (`orders_2005` …) und `legacy_orders_2019` bis `legacy_orders_2023` mit je 410 Spalten
  - `staging`: 500 Tabellen
  - `tenant_001` bis `tenant_300`: 300 gleich aufgebaute Mandanten-Schemas mit je 150 Tabellen, alle mit `tenant_id`

| Aufgabe | Ziel | Schritte |
|---|---|---|
| shop.revenue_per_customer | Shop | search `customer`, search `order`, describe order_items, relations customers → order_items, query Umsatz pro Kunde |
| shop.overview | Shop | search ohne Begriff, describe customers/orders/order_items |
| huge.overview | Huge | search ohne Begriff |
| huge.tenant_id_tables | Huge | search `tenant_id` |
| huge.wide_table_column | Huge | search `loyalty_tier` |
| huge.revenue_per_customer | Huge | search `invoice`, describe public.invoices/public.customers ohne Details |

Neue Aufgaben werden in `tasks()` angehängt, z. B. „eine Funktion verstehen“ oder „über 300 Schemas zählen“. Bestehende Aufgaben behalten ihre Skripte, damit die Zahlen vergleichbar bleiben. Aufgaben ohne Baseline bekommen in der Tabelle „–“.

## Maschine

| | |
|---|---|
| OS | macOS 27.0.1 (Darwin 27.0.0) |
| Arch | arm64 |
| CPU | Apple M3, 8 Kerne |
| RAM | 16 GB |
| Runtime | rustc 1.99.0, `cargo test` Debug-Profil, Tokio current-thread |

Zeiten in ms sind Debug-Build-Werte dieser Maschine und nur zur Orientierung da. Die Bytes hängen nicht von der Maschine ab.

## Baseline (vor Phase 1, Commit `629abcf6` + Benchmark)

Oberfläche:

| Messung | Bytes | ≈Tokens (Bytes/4) |
|---|---:|---:|
| tools/list (14 Tools) | 28.737 | 7.185 |
| instructions | 1.324 | 331 |
| BYOK-Startkatalog | 12.201 | 3.051 |
| davon dashboard | 15.658 | 3.915 |
| davon workflow | 2.030 | 508 |
| davon drilldown | 1.677 | 420 |
| davon script | 1.506 | 377 |
| davon open | 1.269 | 318 |

Aufgaben:

| Aufgabe | Aufrufe | Argumente B | Antworten B | Summe B | ≈Tokens | Info vollständig | ms |
|---|---:|---:|---:|---:|---:|---|---:|
| shop.revenue_per_customer | 4 | 357 | 1.035 | 1.392 | 348 | ja | 222 |
| shop.overview | 2 | 88 | 851 | 939 | 235 | ja | 13 |
| huge.overview | 1 | 21 | 2.052 | 2.073 | 519 | nein: nur 50 Namen aus `analytics`, kein `public`, kein Mandant | 9.193 |
| huge.tenant_id_tables | 1 | 40 | 19.990 | 20.030 | 5.008 | ja, aber 50 Tabellen mit allen Spalten, am Zeichenlimit | 7.266 |
| huge.wide_table_column | 1 | 43 | 12.180 | 12.223 | 3.056 | ja, aber alle 450 Spalten | 6.230 |
| huge.revenue_per_customer | 2 | 123 | 21.837 | 21.960 | 5.490 | nein: search zeigt alphabetisch andere Tabellen, `invoices` fehlt | 18.263 |

`shop.revenue_per_customer` lief in der Baseline mit 4 Aufrufen (1.392 B), weil `search` damals alle Spalten zeigte. Seit Phase 1 zeigt `search` nur passende Spalten, deshalb braucht die Aufgabe `describe order_items` für `unit_price`. Die Antwort von `describe` hat sich nicht geändert (46 + 219 B), die vergleichbare Baseline mit 5 Aufrufen ist also 1.392 + 265 = 1.657 B. Diese Zahl steht in `BASELINE`.

Beobachtungen:

- `dashboard` ist mehr als die Hälfte von `tools/list`, weil das Chart-Schema in `charts.items` und `spec` doppelt steht.
- Ein Suchaufruf auf dem großen Katalog kostet bis zu 20 KB und läuft im Debug-Build 6 bis 9 s. Pro Aufruf wird die Spaltenliste zweimal vollständig kopiert.
- Leerer Suchbegriff und häufige Begriffe zeigen die ersten 50 Treffer alphabetisch. Bei 50.000 Tabellen sieht das Modell so weder Schemas noch die wichtigen Tabellen.

## Phase 1

Änderungen: kompakte veröffentlichte Tool-Definitionen (verschachtelte Dashboard-Schemas nur über `action=chart_types`, das volle Schema bleibt intern für `normalize_args`), Tool-Annotationen nach MCP 2025-06-18, Workflow-Instructions, Katalog-Cache (`mcp/catalog.rs`) mit geteilten Spalten, Namenswörterbüchern und gecachtem `SchemaIndex`, neue Suche (mehrere Wörter, Wortgrenzen, Ranking, nur passende Spalten, Übersicht nach Schemas mit zusammengefassten gleichen Schemas), gecachte kompilierte Maskierungsregeln.

Budgets: `BUDGET` in `token_benchmark.rs`. Der Test schlägt fehl, wenn eine Messung darüber liegt oder einer Aufgabe Information fehlt. Budgets nicht lockern.

Oberfläche:

| Messung | Baseline B | Phase 1 B | ≈Tokens (Bytes/4) | Budget B |
|---|---:|---:|---:|---:|
| tools/list (14 Tools) | 28.737 | 10.207 | 2.552 | 10.240 |
| instructions | 1.324 | 871 | 218 | 950 |
| BYOK-Startkatalog | 12.201 | 8.696 | 2.174 | 9.000 |
| davon dashboard | 15.658 | 1.683 | 421 | |
| davon workflow | 2.030 | 1.152 | 288 | |
| davon drilldown | 1.677 | 945 | 237 | |
| davon script | 1.506 | 901 | 226 | |
| davon open | 1.269 | 706 | 177 | |

Aufgaben:

| Aufgabe | Aufrufe | Baseline B | Phase 1 B | ≈Tokens | Budget B | Info vollständig |
|---|---:|---:|---:|---:|---:|---|
| shop.revenue_per_customer | 5 | 1.657 | 1.360 | 340 | 1.450 | ja |
| shop.overview | 2 | 939 | 947 | 237 | 1.000 | ja |
| huge.overview | 1 | 2.073 | 807 | 202 | 900 | ja (vorher nein) |
| huge.tenant_id_tables | 1 | 20.030 | 2.020 | 505 | 2.200 | ja |
| huge.wide_table_column | 1 | 12.223 | 123 | 31 | 160 | ja |
| huge.revenue_per_customer | 2 | 21.960 | 4.170 | 1.043 | 4.400 | ja (vorher nein) |

## Performance (Phase 1)

Test: `huge_catalog_search_and_query_checks_stay_fast_shared_and_cached` in `token_benchmark.rs`, Aufruf aus `src-tauri/`:

```sh
cargo test --lib huge_catalog_search_and_query -- --nocapture
```

Workload: der `Huge`-Katalog oben (50.007 Tabellen, 1.977.120 Spalten), 1 kalte Suche, 1 kalter `SchemaIndex`, 21 warme Suchen (10 Begriffe ×2 plus leerer Begriff), 20 Query-Vorprüfungen (`Redactor::new` + gecachter `SchemaIndex` + `check_read_sql`) über 5 Statements mit Mandanten-, Archiv- und CTE-Bezug. Die Verbindung zeigt auf `127.0.0.1:1`, jeder Metadatenzugriff auf die Datenbank würde also fehlschlagen.

Geprüft wird:

- 0 Metadaten-Abfragen innerhalb der TTL: Katalog und Spaltenliste sind nach allen Aufrufen per `Arc::ptr_eq` dieselben Objekte, es gibt weder Neuladen noch Kopie.
- Speicher: abgeleitete Indizes (Wörterbücher, Tabellenliste, Familien, `SchemaIndex`) unter 1/8 der rohen Spaltenliste. Höchstens 4 `SchemaIndex`-Varianten pro Katalog und höchstens 8 kompilierte Maskierungsregelsätze.
- Zeiten mit Budgets: kalte Suche < 15 s, kalter Index < 5 s, Suche Median < 500 ms und p95 < 1 s, Vorprüfung Median < 10 ms und p95 < 25 ms.

Messung auf der Maschine oben (Debug-Build, drei Läufe, parallel lief ein anderer Agent; Lauf 3 nach dem Review-Fix):

| Messung | Lauf 1 | Lauf 2 | Lauf 3 |
|---|---:|---:|---:|
| rohe Spaltenliste | ≈275 MB | ≈275 MB | ≈275 MB |
| abgeleitete Indizes | ≈18 MB | ≈18 MB | ≈18 MB |
| kalte Suche (baut Wörterbücher) | 0,99 s | 1,92 s | 3,15 s |
| kalter `SchemaIndex` | 82 ms | 179 ms | 260 ms |
| Suche Median / p95 | 45 / 93 ms | 86 / 176 ms | 123 / 249 ms |
| Vorprüfung Median / p95 | 0,18 / 0,22 ms | 0,34 / 0,43 ms | 0,27 / 0,47 ms |
| davon `Redactor::new` Median | 0,09 ms | 0,18 ms | 0,13 ms |

Zum Vergleich vor Phase 1: eine Suche auf diesem Katalog 6 bis 18 s (Baseline-Tabelle, ms-Spalte), weil jede Suche die Spaltenliste zweimal kopierte. Vor dem Cache der Maskierungsregeln kostete jede Vorprüfung 136 ms Median, fast nur Regex-Kompilierung. Nicht gemessen: Release-Build, Linux/Windows, echte PostgreSQL-Kataloge dieser Größe, gedrosselte CPU.

Cache-Verhalten: Für `search`, `describe`, `relations`, `open` und Dashboard-Joins gilt ein Katalog 10 min. Sicherheitsprüfungen (`check_read_sql`/`check_write_sql` in query, execute, script, benchmark, sandbox, drilldown, dashboard, explain) laden ihn wie vor Phase 1 neu, sobald er älter als 60 s ist. Neue Tabellen, Spalten und Schemas außerhalb des MCP sind für die Prüfungen also nicht länger unbekannt als vorher. Jedes `execute`, jeder Workflow-Lauf und jeder CSV-Import im KI-Arbeitsbereich verwirft den Katalog der Verbindung. `search` mit `refresh=true` lädt neu.

## Phase 2

Änderungen:

- **Katalog um Objekte erweitert** (`mcp/objects.rs`). Tabellen erscheinen mit Art, Zeilenschätzung, Größe und Kommentar. Dazu kommen Views, materialisierte Views, Funktionen und Prozeduren (Signatur, Rückgabetyp, Sprache) sowie Trigger, wo das billig ist (PostgreSQL, SQLite).
- **Stufenweises Laden mit Sammelabfragen:**
  1. Objekte und Statistiken
  2. Spalten
  3. Schlüssel
  4. Quelltext nur bei Bedarf, in einem LRU mit 32 Einträgen und 8 MiB, nie auf Platte
- **Persistenter Katalog** (`mcp/persist.rs`). Er nimmt nur Metadaten aus freigegebenen Schemas auf, mit Rechten 0600/0700.
  - Der Dateischlüssel hasht Format-Version, Verbindung, Datenbank, Schema-Freigabe und Maskierungsregeln.
  - Er wird nur geschrieben, wenn die globale `mcp.json` die Verbindung mit demselben Schlüssel freigibt.
  - Verwaiste Dateien werden beim Speichern der MCP-Konfiguration gelöscht.
  - Ein Prozess erkennt an der mtime, dass ein anderer die Datei verworfen hat.
- **TTL:** Die Entdeckungswerkzeuge nutzen eine adaptive TTL (Ladezeit × 600, zwischen 10 min und 6 h). Sicherheitsprüfungen laden weiter nach höchstens 60 s live und lesen nie die Datei.
- **Neues Tool `overview`** (`mcp/overview.rs`).
- **`search`** deckt alle Objektarten ab (`kind`, `in=source`) und durchsucht das KI-Wissen.
- **`describe`** zeigt Tabellen kompakt, mit `columns`-Filter für breite Tabellen. Für Routinen und Views kommen Abhängigkeiten und Quelltext-Ausschnitte (`lines`) hinzu.
- **KI-Wissen per Pull:** Im Systemprompt stehen nur Notizen, ein kurzes Glossar und die Datenregeln.
- **Schema-Freigabe:** Die Katalogabfragen filtern freigegebene Schemas schon in SQL (bis 1.000 Schemas, darüber nur nachträglich).
  - Quelltextzeilen und Treffer, die ein nicht freigegebenes Schema nennen (auch in `"…"`, `` `…` `` oder `[…]`), werden ausgeblendet. Dafür wird die Schemaliste einmal pro Katalog abgefragt. Scheitert diese Abfrage, gilt jeder nicht freigegebene Qualifier als verborgen.
  - Triggerfunktionen und Typen in Signaturen aus solchen Schemas erscheinen als `[hidden]`, auch in der Datei.

Neue Aufgaben auf dem `Huge`-Katalog. Er ist jetzt um 1.000 Views, 150 materialisierte Views, 20.000 Routinen, 50 Trigger und 6.201 Fremdschlüssel ergänzt, also 51.157 Relationen. 20 Routinen haben 5.211 Zeilen Quelltext, zusätzlich gibt es 301 Tabellenbeschreibungen und ein Glossar.

| Aufgabe | Schritte |
|---|---|
| huge.map | overview |
| huge.zoom_schema | overview schema=public |
| huge.understand_routine | describe einer Routine mit 5.211 Zeilen (Signatur, Abhängigkeiten, erste 120 Zeilen, Hinweis auf den nächsten Ausschnitt) |
| huge.writers_of_table | search `in=source` mit `INSERT INTO public.payments\|UPDATE public.payments` (15 Routinen) |
| huge.knowledge_column | search nach einem Fachbegriff, der nur in einer Spaltenbeschreibung steht (`Mahnstufe`) |

Für die neuen Aufgaben gibt es keine Messung vor Phase 1, weil es die Werkzeuge nicht gab. Ihre Baseline ist **modelliert** und wird im Test aus den synthetischen Daten berechnet (`modeled()`). Ausgegangen wird jeweils von einem Modell, das ohne die neuen Werkzeuge über `query` auf die Systemkataloge geht:

| Aufgabe | modellierte Baseline |
|---|---|
| huge.map | 3 Abfragen auf `pg_class`/`pg_proc`: alle 304 Schemas mit Tabellen, Zeilen und Größe, die 10 größten Tabellen, Objektzahlen |
| huge.zoom_schema | 2 Abfragen: Namenspräfixe in `public` mit Zeilen, die 10 größten Tabellen in `public` |
| huge.understand_routine | die ganze Definition über `pg_get_functiondef` in 7 Stücken zu `max_chars` |
| huge.writers_of_table | Regex über `prosrc`, dann die 15 Treffer lesen, um sie zu bestätigen (eine davon hat 5.200 Zeilen). Ein Experte, der nur die Namen abfragt und den Treffern glaubt, käme mit etwa 0,6 KB aus. Diese untere Grenze liegt unter Phase 2, liefert aber weder Zeile noch Ausschnitt. |
| huge.knowledge_column | Phase 1 schickte im KI-Arbeitsbereich alle Tabellenbeschreibungen in jedem Systemprompt mit (24.056 B). Der externe MCP kannte das Wissen gar nicht. |

Oberfläche:

| Messung | Baseline B | Phase 1 B | Phase 2 B | ≈Tokens | Budget B |
|---|---:|---:|---:|---:|---:|
| tools/list (15 Tools) | 28.737 | 10.207 | 10.215 | 2.554 | 10.240 |
| instructions | 1.324 | 871 | 857 | 215 | 950 |
| BYOK-Startkatalog | 12.201 | 8.696 | 8.896 | 2.224 | 9.000 |
| davon overview | – | – | 393 | 99 | |
| davon search | – | – | 611 | 153 | |
| davon describe | – | – | 615 | 154 | |

`overview` passt ohne Budgeterhöhung in `tools/list`. Andere Beschreibungen wurden dafür gekürzt. Für schreibgeschützte Tools stehen in den Annotationen nur noch `readOnlyHint` und `openWorldHint`, weil die übrigen Hinweise laut MCP-Spezifikation nur für schreibende Tools gelten.

Aufgaben (≈Tokens = Bytes/4):

| Aufgabe | Baseline B | Phase 1 B | Phase 2 B | ≈Tokens Phase 2 | Budget B | Info vollständig |
|---|---:|---:|---:|---:|---:|---|
| shop.revenue_per_customer | 1.657 | 1.360 | 1.355 | 339 | 1.450 | ja |
| shop.overview | 939 | 947 | 957 | 240 | 1.000 | ja |
| huge.overview | 2.073 | 807 | 900 | 225 | 900 | ja |
| huge.tenant_id_tables | 20.030 | 2.020 | 2.077 | 520 | 2.200 | ja |
| huge.wide_table_column | 12.223 | 123 | 155 | 39 | 160 | ja |
| huge.revenue_per_customer | 21.960 | 4.170 | 4.358 | 1.090 | 4.400 | ja |
| huge.map | 11.345 (modelliert) | – | 1.739 | 435 | 1.900 | ja |
| huge.zoom_schema | 2.557 (modelliert) | – | 1.378 | 345 | 1.500 | ja |
| huge.understand_routine | 136.626 (modelliert) | – | 3.960 | 990 | 4.400 | ja |
| huge.writers_of_table | 144.448 (modelliert) | – | 2.346 | 587 | 2.600 | ja |
| huge.knowledge_column | 24.056 (modelliert) | – | 240 | 60 | 300 | ja |

Die Phase-1-Aufgaben wurden um 8 bis 190 B größer. Dafür gibt es drei Gründe:

- Jede Entdeckungsantwort nennt jetzt die Katalogzeit (`· catalog HH:MM`).
- Treffer tragen Kennung und Zeilenschätzung.
- `describe` zeigt Spaltenbeschreibungen.

Alle bestehenden Budgets halten. `huge.overview` liegt genau am Budget, weil die leere Suche nur noch Schemas mit Zeilen und Größe zeigt, damit sie zu `overview` passt.

KI-Wissen im Systemprompt pro Anfrage: 24.056 B in Phase 1, 465 B in Phase 2 (synthetisches Wissen mit 301 Tabellenbeschreibungen).

## Performance (Phase 2)

Test: `catalog_stages_overview_search_and_persistence_stay_fast_bounded_and_cached` in `token_benchmark.rs`, Aufruf aus `src-tauri/`:

```sh
cargo test --lib token_benchmark -- --nocapture --test-threads=1
```

Workload: der erweiterte `Huge`-Katalog oben, Verbindung auf `127.0.0.1:1`.

- 15 `overview`-Aufrufe
- 15 Zooms über `public`, `analytics` und `tenant_042`
- 15 Suchen mit Objektarten
- 8 Quelltextsuchen, darunter eine ohne Treffer
- 1 `describe` einer Routine mit 5.211 Zeilen
- Speichern und Laden der Katalogdatei

Geprüft wird:

- Gecachte Stufen fragen die Datenbank 0-mal ab, `describe` einer Routine höchstens einmal (für die von der Datenbank gemeldeten Abhängigkeiten).
- Jede Antwort bleibt unter `max_chars`.
- Der geladene Katalog stimmt mit dem gespeicherten überein (Spalten, Routinen, Fremdschlüssel). Quelltext wird nicht gespeichert.
- Budgets:
  - `overview` Median < 400 ms, p95 < 800 ms
  - Zoom Median < 300 ms
  - Suche mit Objektarten Median < 600 ms, p95 < 1,2 s
  - Quelltextsuche Median < 800 ms
  - `describe` < 800 ms
  - Speichern < 8 s, Laden < 10 s
  - Datei < 40 MB
  - Objekte im Speicher < 32 MB

Das Objektbudget ist neu. Es wurde nach der ersten Messung (20,95 MB) auf 32 MB gesetzt, also nicht nachträglich gelockert.

Messung auf der Maschine oben (Debug-Build, ein Lauf, `--test-threads=1`):

| Messung | Phase 2 |
|---|---:|
| `overview` Median / p95 | 143 / 176 ms |
| Zoom Median / p95 | 80 / 81 ms |
| Suche mit Objektarten Median / p95 | 199 / 218 ms |
| Quelltextsuche Median / p95 | 203 / 320 ms |
| `describe` Routine (5.211 Zeilen) | 302 ms |
| Katalogdatei | 19,6 MB |
| Speichern / Laden | 1,30 / 1,00 s |
| Objekte im Speicher (51.157 Relationen, 20.000 Routinen) | ≈20 MB |
| Quelltext-Cache im Test (alle 20.000 vorgeladen) | ≈14 MB |
| rohe Spaltenliste / abgeleitete Indizes | ≈275 / ≈18 MB |
| Phase-1-Test: kalte Suche, Suche Median / p95 | 310 ms, 217 / 255 ms |
| Phase-1-Test: Vorprüfung Median / p95 | 0,16 / 0,22 ms |

Im Betrieb begrenzt der LRU den Quelltext-Cache auf 8 MiB. Der Test lädt alle Quelltexte vor, um die Quelltextsuche ohne Datenbank zu messen.

Datenbankabfragen beim Katalogaufbau:

- SQLite: höchstens 3 Abfragen, Wiederholungen 0 (`sqlite_objects_load_in_few_queries_and_describe_views_and_triggers`).
- PostgreSQL: 4 gezählte Katalogabfragen beim ersten `search`. Wiederholte Suchen fragen 0-mal ab, das erste `overview` braucht 1 Abfrage für die Schlüssel.

Nicht gemessen: Release-Build, Linux und Windows, gedrosselte CPU, echte Kataloge dieser Größe.

### Echte Datenbanken

- **PostgreSQL 17.11** (Homebrew, lokal auf derselben Maschine) über den ignorierten Test `live_postgres_catalog_stages_use_bulk_queries_and_respect_the_allowlist` in `mcp/objects.rs` (`L8DB_E2E_PG_URL`). Abgedeckt sind:
  - Tabelle mit Kommentar und Fremdschlüssel, partitionierte Tabelle
  - View, materialisierte View
  - SQL- und plpgsql-Funktion, Prozedur, Trigger
  - eine View auf ein nicht freigegebenes Schema
  - ein Trigger, der eine Funktion aus dem verborgenen Schema aufruft, und eine Funktion mit einem Typ aus dem verborgenen Schema
  - Geprüft wird, dass Kennungen, Zeilenschätzungen, Kommentare, gemeldete und lexikalische Abhängigkeiten, die Quelltextsuche über `search_source`, die Maskierung verborgener Schemas (auch bei einem Katalog, der wie von Platte nur freigegebene Schemas enthält) und die Anzahl der Abfragen stimmen.
- **SQLite und DuckDB:** lokale Tests (`sqlite_objects_load_in_few_queries_and_describe_views_and_triggers`, `duckdb_views_carry_estimates_comments_and_sources`).
- **Nicht gegen echte Server getestet:** die Katalog-SQL für MySQL/MariaDB, SQL Server, Oracle und ClickHouse. Sie ist nach Dokumentation geschrieben. Schlägt eine Abfrage fehl, fällt der Katalog ohne Fehlermeldung auf leere Objekte zurück (nur im Speicher, nicht persistiert), und `search`/`describe` arbeiten wie in Phase 1 auf Tabellen und Spalten. Andere Familien liefern Routinen nur, soweit der Adapter `list_functions`/`list_procedures` kennt.

Grenzen:

- Unqualifizierte Verweise auf verborgene Schemas (über `search_path`) erkennt die Maskierung nicht.
- DDL außerhalb von MCP und KI-Arbeitsbereich (SQL-Editor, andere Clients) sehen die Entdeckungswerkzeuge erst nach Ablauf der TTL oder mit `refresh=true`. Sicherheitsprüfungen sind davon nicht betroffen.
- Der Katalog wird nur persistiert, wenn die globale MCP-Konfiguration die Verbindung mit identischer Schema-Freigabe und Maskierung freigibt. Sonst bleibt er im Speicher.
