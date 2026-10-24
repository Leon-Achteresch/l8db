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
