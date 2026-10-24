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

## Phase 3

Änderungen:

- **Neues Tool `code`** (`mcp/code.rs` Host, `mcp/code_worker.rs` Worker, `mcp/code_prelude.js` Bindings), nach dem Code-Mode-Muster: Das Modell schreibt eine JS-Funktion `async () => {…}` gegen typisierte Bindings. Zurück kommen nur der Rückgabewert (Array flacher Objekte als TSV, Text unverändert, sonst kompaktes JSON, auf `max_chars` gekürzt), gesammelte `console.log`-Zeilen und eine Fußzeile wie `(300 statements, 300 rows read, 0.9 s)`. `search`, `describe` und `query` bleiben unverändert, `code` kommt dazu.
- **Engine:** QuickJS-ng 0.16.2 über `rquickjs` 0.14 (MIT, dazu `rquickjs-core`, `rquickjs-sys` und `relative-path`, MIT/Apache-2.0), ohne `std`/`os`-Module. Der JS-Kontext hat also weder Netzwerk noch Dateien noch Umgebung. Größe im Spike: +1,14 MB im Release-Profil (arm64, eigenes Scratch-Crate mit `opt-level = 3`, thin LTO, `strip`). Das ganze App-Bundle wurde nicht neu gemessen.
- **Prozessgrenze:** Jeder Aufruf startet einen frischen Worker `l8db --mcp-sandbox` über `current_exe`. `lib.rs` erkennt das Flag als Erstes in `run()`, also vor CLI-Erkennung, ODBC, Logger, Tauri und Single-Instance.
  - Umgebung: `env_clear`, nur unter Windows `SystemRoot`, unter Linux `LD_LIBRARY_PATH`.
  - IPC: JSON-Zeilen über stdin/stdout. Der Host liest mit festen Grenzen (Nachricht 4 MB, Antwort an den Worker 8 MB, insgesamt 64 MB pro Lauf, 5.000 Aufrufe). stderr wird auf 2 KB begrenzt gelesen.
  - Handles: Unter Unix schließt der Worker beim Start alle geerbten Deskriptoren > 2. `kill_on_drop` beendet ihn, wenn das Future fallen gelassen wird (BYOK-Abbruch, Zeitlimit des Clients).
  - Der Worker sieht weder Schlüsselbund noch Verbindungen noch Konfiguration. Er bekommt nur Code und Limits und fragt jeden Wert beim Host an.
- **Limits:**

| Limit | Wert |
|---|---|
| JS-Speicher / Stack | 64 MB / 1 MB (QuickJS `set_memory_limit`, `set_max_stack_size`) |
| Gesamtzeit | 4 × Abfrage-Zeitlimit, mindestens 120 s. Ein Interrupt-Handler stoppt das JS (nicht abfangbar), nach weiteren 2 s wird der Prozess hart beendet. |
| Anweisungen | 500 pro Lauf, 4 gleichzeitig, jede mit dem Abfrage-Zeitlimit |
| Zeilen | 10.000 pro Anweisung, schon beim Lesen begrenzt (`with_row_limit`, wirksam bei PostgreSQL, MySQL, SQLite, DuckDB und Oracle), 250.000 pro Lauf. Wartende Anweisungen laufen nicht mehr an, sobald das Budget verbraucht ist. |
| Katalogaufrufe | 500 pro Lauf. Ergebnisse standardmäßig 1.000 Einträge, höchstens 10.000 (`grep` 200 / 2.000). |
| Ergebnis | `max_chars`. Lange Arrays werden halbiert, bis sie passen, mit Hinweis auf die Gesamtzahl. |
| `console.log` | 100 Zeilen, 8.000 Zeichen im Worker, 3.000 in der Antwort, gezählt verworfen |

Gewünscht waren etwa 200 Anweisungen. 500 sind es geworden, damit eine Schleife über die 300 Mandanten-Schemas des Benchmarks in einen Lauf passt. Gleichzeitig laufen trotzdem nie mehr als 4.

- **Sicherheit:** Jede Anweisung aus `sql`, `query` und `explain` läuft über denselben Weg wie `query`:
  - `check_read_sql`, Schema-Freigabe, geschwärzte Spalten (über `schema_index`, also den Live-Katalog, höchstens 60 s alt)
  - Read-only-Sitzung (`guarded` mit `read_only: true`)
  - Abfrage-Zeitlimit und ein Audit-Eintrag pro Anweisung mit `tool=code`
  - Der Redactor schwärzt Zellen, bevor sie den Worker erreichen. Rückgabetext, `console.log` und JS-Fehler laufen zusätzlich durch die globalen Wertregeln, Fehler durch `scrub_error`.
  - `check_read_sql` liest jede Anweisung zusätzlich im genauen Dialekt der Verbindung (MySQL, PostgreSQL/DuckDB, SQLite, ClickHouse/BigQuery). Das schließt eine ältere Lücke, die auch `query` betraf. Details stehen in [ai-workspace.md](ai-workspace.md#prüfen-simulieren-erklären).
  - Werte gehen als Literale im Dialekt der Verbindung in das SQL. Bezeichner sind nur über `id()` möglich, ein Objekt, das der Code nicht fälschen kann. `sql.with({connection, database})` erreicht nur exponierte SQL-Verbindungen, jeweils mit deren eigenen Prüfungen.
  - Die Katalog-Bindings (`schemas`, `tables`, `columns`, `routines`, `source`, `grep`, `references`, `path`) nutzen die Entdeckungssicht mit `View::hides` und `mask_hidden`. Für die Sicherheitsprüfungen bleibt es beim Live-Katalog.
- **Oberfläche:** `code` steht in `tools/list` (nur wenn eine exponierte Verbindung SQL spricht), in den Instructions (ein Satz) und im BYOK-Startkatalog (`CORE`). Im KI-Arbeitsbereich gilt es als Lese-Tool: im Plan-Modus erlaubt, Freigabe wie `query`.
- **Fix nebenbei:** Der DuckDB-Katalog lud bisher nur Spalten aus `main`. Jetzt lädt eine Sammelabfrage auf `duckdb_columns()` alle Schemas.

Beispiel (Aufgabe `code.tenant_orphans`):

```js
async () => {
  const schemas = (await catalog.tables({ name: "orders" })).map((t) => t.schema);
  const counts = await Promise.all(schemas.map((s) => sql`SELECT count(*) AS n FROM ${id(s, "orders")} o WHERE NOT EXISTS (SELECT 1 FROM ${id(s, "customers")} c WHERE c.id = o.customer_id)`));
  return schemas.map((schema, i) => ({ schema, orphans: counts[i][0].n })).filter((r) => r.orphans > 0);
}
```

Antwort: 42 Zeilen `schema	orphans` als TSV und `(300 statements, 300 rows read, 0.9 s)`.

Neue Ziele im Test (`code_lab()`), echte Dateien in einem temporären Verzeichnis:

- `Tenants`: DuckDB mit 300 gleich aufgebauten Schemas `tenant_001` bis `tenant_300`. Jedes enthält `customers` (5 Zeilen) und `orders` (so viele Zeilen wie die Mandantennummer, mit `updated_at`). Jedes siebte Schema hat 1 bis 5 verwaiste Bestellungen.
- `Shop A` und `Shop B`: zwei SQLite-Dateien mit je 12 Tabellen. In B haben `t04`, `t08` und `t12` mehr Zeilen.

Neue Aufgaben. Die Baseline ist die tatsächlich ausgeführte Folge einzelner Tool-Aufrufe ohne `code`. Sie läuft im selben Test und wird mitgemessen:

| Aufgabe | Baseline | code |
|---|---|---|
| code.tenant_orphans | overview, dann 300 × query `count(*) … NOT EXISTS` (eine pro Schema) | 1 Aufruf: `catalog.tables`, 300 Anweisungen |
| code.latest_updated | search `updated_at`, query auf `duckdb_tables()` (50 größte), dann 50 × query `max(updated_at)` | 1 Aufruf: `catalog.tables({column, limit: 50})`, 50 Anweisungen |
| code.compare_counts | query `sqlite_master` auf A, je eine UNION-ALL-Zählabfrage auf A und B | 1 Aufruf mit `sql.with({connection: "Shop B"})`, 24 Anweisungen, nur abweichende Tabellen |
| code.payment_writers | search `in=source` (15 schreibende Routinen), 2 × describe mit `lines=1-1` für die Zeilenzahlen | 1 Aufruf: `catalog.grep` + `catalog.routines` auf `Huge` |

Die Baseline von `code.compare_counts` ist bewusst stark: Ein Modell, das pro Tabelle zählt, bräuchte 24 Aufrufe. Eine handgeschriebene UNION-ALL-Abfrage über 300 Schemas wäre ein einzelner Aufruf, aber allein die Argumente wären etwa 45 KB groß.

Ergebnis (≈Tokens = Bytes/4, Zeiten im Prozess ohne Modell-Rundreisen):

| Aufgabe | Aufrufe Baseline | Baseline B | ≈Tokens | Aufrufe code | code B | ≈Tokens | gespart | Budget B | Info vollständig | ms Baseline / code |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---:|
| code.tenant_orphans | 301 | 55.926 | 13.982 | 1 | 1.049 | 263 | 98 % | 1.200 | ja | 1.224 / 641 |
| code.latest_updated | 52 | 7.487 | 1.872 | 1 | 2.473 | 619 | 67 % | 2.700 | ja | 166 / 332 |
| code.compare_counts | 3 | 1.637 | 410 | 1 | 488 | 122 | 70 % | 600 | ja | 7 / 277 |
| code.payment_writers | 3 | 7.691 | 1.923 | 1 | 1.274 | 319 | 83 % | 1.450 | ja | 3.646 / 706 |

Der Test prüft die Budgets und zusätzlich, dass `code` bei jeder Aufgabe kleiner ist als die Baseline. Die Zeitspalte zählt nur die Arbeit im Prozess. Im echten Einsatz kostet jeder der 301 Baseline-Aufrufe zusätzlich eine Modellrunde.

Oberfläche:

| Messung | Phase 2 B | Phase 3 B | ≈Tokens | Budget Phase 2 B | Budget Phase 3 B |
|---|---:|---:|---:|---:|---:|
| tools/list (16 Tools) | 10.215 | 11.910 | 2.978 | 10.240 | 11.935 |
| davon code | – | 1.694 | 424 | – | |
| instructions | 857 | 932 | 233 | 950 | 950 |
| BYOK-Startkatalog | 8.896 | 10.518 | 2.630 | 9.000 | 10.622 |

Begründung der Budgeterhöhung:

- `tools/list` wächst genau um die `code`-Definition: 1.694 B plus 1 B Trennzeichen, also 10.240 + 1.695 = 11.935.
- Der BYOK-Startkatalog wächst genau um den `code`-Eintrag ohne Annotationen: 1.621 B plus 1 B, also 9.000 + 1.622 = 10.622.
- Die übrigen Tools liegen unverändert bei 10.215 B, also unter dem alten Budget.
- Die Instructions haben einen Satz zu `code` bekommen und liegen trotzdem unter dem alten Budget von 950 B, weil der Rest gekürzt wurde.
- Die Definition enthält die Typen der Bindings als kompakte d.ts (etwa 1.000 B). Ohne sie müsste das Modell die API raten oder erst nachschlagen. Gekürzt wurde von 1.832 auf 1.694 B: ein gemeinsamer Filtertyp und ein einziges `declare`.
- Die Ersparnis entsteht in den Aufgaben, nicht durch Streichen bei anderen Tools. Schon `code.tenant_orphans` spart in einem Lauf mehr als das 30-fache der Definition.

## Performance (Phase 3)

Tests in `mcp/code_tests.rs`, Aufruf aus `src-tauri/`:

```sh
cargo test --lib mcp::code -- --nocapture --test-threads=1
```

Im Test startet der Worker als dasselbe Testbinary (`worker_entry`, `L8DB_CODE_WORKER=1`). Mit `L8DB_TEST_SANDBOX_EXE=<pfad>/l8db` läuft er als echtes App-Binary.

| Messung | Budget | Ergebnis |
|---|---|---:|
| Worker-Start Median / p95 (Testbinary) | < 400 / < 800 ms | 258 / 262 ms |
| Worker-Start Median / p95 (Debug-App-Binary, 441 MB) | – | 248 / 431 ms |
| Overhead pro `sql`-Aufruf (200 nacheinander, SQLite) | < 3 × `query`-Median und < 10 ms | 0,39 ms (`query`-Tool: 1,13 ms) |
| 24 Anweisungen gegen einen Server mit 40 ms Latenz | höchstens 4 gleichzeitig, genau 24 Anfragen | 4 gleichzeitig (am Server und im Host gezählt), 24 Anfragen, 598 ms |
| Endlosschleife (auch in `try/catch`) | Abbruch am Zeitlimit, kein Worker übrig | ja |
| Speicher (wachsendes Array), tiefe Rekursion, 5-MB-String, Array mit 50.000 Einträgen, 5.000 Logzeilen | Fehler mit Hinweis bzw. gekürztes Ergebnis, Host-Speicher begrenzt | ja |
| Abbruch nach 400 ms (Future fallen gelassen) | Worker-Prozess weg, < 3 s | ja |
| Leerlauf | kein Worker zwischen Aufrufen (Prozess existiert nur während eines Aufrufs) | ja, per `kill(pid, 0)` geprüft |

Der Start wird vom Laden des Binarys bestimmt, nicht von QuickJS. `l8db --version` braucht mit demselben Debug-Binary ebenfalls 0,24 s, eine installierte Release-Version 0,01 bis 0,03 s. Den Start des Release-Workers habe ich nicht gemessen.

Missbrauchsfälle (`masked_columns_writes_and_injection_attempts_stay_blocked`, `catalog_bindings_return_structured_data_and_never_show_hidden_schemas`, `values_become_dialect_literals_and_names_only_come_from_id`):

- geschwärzte Spalten: `SELECT *` liefert sie maskiert, `SELECT email`, `WHERE email` und `upper(c.email)` werden abgelehnt
- sechs Schreibversuche werden abgelehnt (`DELETE` und `UPDATE` über `sql`, `DROP`, `INSERT` und `SELECT 1; DELETE …` über `query`, `explain('DELETE …')`), die Zeilenzahl bleibt gleich
- `x' OR '1'='1` und ein Text `` ${sql`DELETE …`} `` werden zu Literalen. Ein verschachteltes `sql`-Template und ein gefälschtes `id()`-Objekt (`{i: [...]}`) werfen `TypeError`. Literale werden je Dialekt geprüft (`'`, `\`, `--`, `N'…'`, `E'…'`).
- überschriebene `Object.prototype.toJSON`, `Array.prototype.map` und `JSON.parse` stören die Bindings nicht
- über `eval`, `Function` und den Konstruktor von Async-Funktionen sind weder `require`, `process`, `std`, `os`, `fetch`, `setTimeout` noch interne Host-Funktionen erreichbar
- verborgene Schemas erscheinen in keinem Katalog-Binding, auch nicht über eine View, die auf ein verborgenes Schema zeigt

Plattformen:

- **macOS arm64:** lokal getestet (Maschine oben).
- **Linux x86_64:** `cargo test` in CI (ubuntu-22.04) beim Push auf `development`.
- **Windows (MSVC):** Für x86_64 und aarch64 liefert `rquickjs-sys` vorgenerierte Bindings mit. Gebaut wird Windows aber nur in PRs und Releases. Ungetestet: Worker-Start, Handle-Vererbung (das Schließen geerbter Deskriptoren gibt es nur unter Unix) und `SystemRoot` als einzige Variable.

Review: Ein unabhängiger Sicherheitsreview (Prozessgrenze, IPC, Limits, Maskierung, verborgene Schemas, Injection, Zombies, Single-Instance) mit einer Fix-Runde fand:

- **Hoch, behoben:** Die Leseprüfung kannte Backslash-Escapes in `"…"` (MySQL) und `` `…` `` (ClickHouse, BigQuery) nicht. Damit ließen sich geschwärzte Spalten und, unter MySQL, zweite Anweisungen verstecken. Diese Lücke war älter und betraf auch `query`. Bei der Prüfung tauchten weitere Mischformen auf: `--x` und nicht verschachtelte Kommentare in MySQL/SQLite, `E'…'` und `[` in PostgreSQL sowie Dollar-Tags, die beliebigen Text verschluckten. Behoben ist das über die zusätzliche Dialekt-Lesart, Regressionstest `dialect_readings_close_quote_and_comment_mixing`.
- **Mittel, behoben:** Das Zeilenbudget wurde nur beim Einreichen geprüft, und gelesen wurde ohne Grenze. Jetzt begrenzt `with_row_limit` das Lesen, und wartende Anweisungen prüfen das Budget erneut.
- **Niedrig, behoben:** Katalogaufrufe sind auf 500 begrenzt. Wertregeln gelten auch für Text, Logs und Fehler.
- **Mittel, offen:** keine Sandbox auf Betriebssystemebene (seccomp/Landlock, `sandbox_init`, AppContainer). Der Worker ist dasselbe Binary mit denselben Benutzerrechten. Eine Speicherlücke in QuickJS könnte daher auf Dateien und Schlüsselbund des Benutzers zugreifen. Env, Deskriptoren und Bindings schützen nur, solange QuickJS dicht ist.
- **Niedrig, offen:** Unter Windows werden vererbbare Handles nicht eingeschränkt (`PROC_THREAD_ATTRIBUTE_HANDLE_LIST` fehlt).

Grenzen:

- Der BYOK-Server hält die Server-Sperre für die Dauer eines `code`-Laufs, genauso wie bei `query`.
- Adapter ohne `with_row_limit` (SQL Server, ClickHouse, Snowflake, BigQuery …) lesen eine Anweisung vollständig in den Host, bevor sie gekürzt wird, wie bei `query`.
- Ein Lauf liest höchstens 250.000 Zeilen. Für große Auswertungen gehört die Aggregation ins SQL.
- RegExp-Filter folgen der Rust-Syntax (ohne Lookaround), nicht der JS-Syntax.
