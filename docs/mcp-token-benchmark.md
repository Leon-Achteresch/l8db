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
| shop.revenue_per_customer | Shop | search `customer`, search `order`, relations customers → order_items, query Umsatz pro Kunde |
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

Beobachtungen:

- `dashboard` ist mehr als die Hälfte von `tools/list`, weil das Chart-Schema in `charts.items` und `spec` doppelt steht.
- Ein Suchaufruf auf dem großen Katalog kostet bis zu 20 KB und läuft im Debug-Build 6 bis 9 s. Pro Aufruf wird die Spaltenliste zweimal vollständig kopiert.
- Leerer Suchbegriff und häufige Begriffe zeigen die ersten 50 Treffer alphabetisch. Bei 50.000 Tabellen sieht das Modell so weder Schemas noch die wichtigen Tabellen.
