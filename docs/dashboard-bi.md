# Dashboards as pages and BI

Dashboards can be built like a company's own site: several pages, a branded header,
content blocks and interactive charts. Everything is also available to the AI through
the `dashboard` MCP tool (`chart_types` lists the format).

## Pages

`pages: [{ id, name, hidden? }]`. Widgets carry `page`; a missing or unknown page means
the first page, so dashboards without pages behave as before. Pages are added, renamed,
reordered, hidden from the navigation (still reachable through link buttons) and deleted
in edit mode. Deleting a page removes its widgets and their datasets. The theme decides
whether pages show as tabs or as a sidebar.

## Content blocks

A widget with `block` is a content block instead of a chart. It is stored with
`chart: "table"` and `datasetId: null`, so older versions show it as an empty card
instead of failing.

| Type | Fields |
| --- | --- |
| `text` | `text` (Markdown, `{{variable}}` shows the current filter value), `align`, `variant` |
| `image` | `src` (`data:image/...` only, 512 KiB), `fit`, `text` (alt), optional `href` |
| `link` | `text` (label), `page` (target page) or `href` (https), `align`, `variant` |
| `divider` | optional `text` (section title), `align` |

Remote images are blocked by the app CSP, so images and logos are embedded as data URLs.
Links open only https addresses through the system browser.

## Theme

`theme` holds `brand`, `tagline`, `logo`, the colors `primary`, `background`, `surface`,
`text`, `muted`, `border`, `palette` (up to 8), `font`, `radius` (0-32), `card`
(`outlined`, `elevated`, `flat`, `glass`), `density`, `header` and `nav`. Colors must be
hex, `rgb()`, `hsl()`, `oklch()` or `oklab()`; anything else is rejected when saving,
importing or syncing and dropped from the live preview. The theme compiles to scoped CSS
before the dashboard's own CSS.

## Interactions

- **Cross filter** (`options.crossFilter`, default on): clicking a bar, slice, row or
  pivot cell offers "Dashboard danach filtern". Other charts that read the same table
  (base table or a join) get `column = value`; time buckets compare the bucketed
  expression. Expert SQL charts are wrapped when their mapped dimension has the same
  name and the SQL reads the source table. A linear tokenizer finds table positions
  (after FROM, JOIN, ONLY, LATERAL or a comma in a FROM list, per parenthesis level,
  with "", `` and [] identifiers (brackets for SQL Server, SQLite and ODBC), Unicode
  names and parenthesized join lists; comments (nested for PostgreSQL, SQL Server, DuckDB
  and ClickHouse, `#` for MySQL and BigQuery), string literals (double-quoted strings
  for MySQL and BigQuery, backslash escapes for MySQL, ClickHouse, BigQuery and
  Snowflake; for ODBC and unknown dialects a bracket directly after a name, a field access, `)` or
  `]` is an array subscript, after a keyword, operator or numeric literal it is a
  bracket identifier, and after whitespace or a comment it is a subscript only when its
  content starts with a quote, digit, `$`, `:` or `-`), Oracle q-quoted and dollar-quoted literals are ignored).
  Tokens are cached for the 64 most recently used statements. List-valued dimension values are
  not offered for filtering, and drill-through needs every clicked axis to be scalar. Charts that do not share the column are untouched and do not
  query again.
  Selections live in memory per dashboard and are shown as removable chips.
- **Drill-through** (`options.drill`, default on): "Details anzeigen" loads up to 200
  underlying rows (with joins only the base table's columns) with the chart's filters,
  period and selection. The dialog shows the SQL and exports CSV.
- **CSV export** of any chart's current result from the card menu.
- **Pivot** chart: rows × columns × one metric with an optional color scale. With
  `totals`, builder charts load exact row, column and grand totals through three extra
  grouped queries ("Gesamt"; averages stay averages, not sums of averages). Expert SQL
  charts fall back to the loaded rows ("Summe (geladen)"; builder fallbacks say "Gesamt
  (geladen)": sums for sum/count, min/max ignore NULL and non-numeric values, other
  aggregates show "–").
- **Tables**: totals row and data bars (`totals`, `dataBars`). Builder charts query the
  exact total over all rows (shared with the headline total query when identical);
  expert SQL charts show "Summe geladener Zeilen". Exact queries run only when the
  result is truncated or a metric is not additive.
- **Keyboard**: bars, funnel stages, table rows, pivot headers, ring and treemap
  segments are focusable; Enter or Space opens the same filter/details menu as a click.
- **Target lines** (`target`, `targetLabel`) on line, area, column, bar and KPI charts.
- **Presentation mode** hides the editor, switches the window to fullscreen and ends
  with Esc. Verified in a real Tauri 2.12.1 window (WebKitGTK, Xvfb 1920×1080, no
  window manager): `setFullscreen(true/false)` from the webview toggles
  `isFullscreen()` with `core:window:allow-set-fullscreen`, and without it Tauri
  rejects the call. The full l8db app was not driven end to end in a real window, and
  macOS/Windows were not tested.

## Performance

`tests/perf-dashboard-bi.test.ts` (core suite) covers cross-filter fan-out over 60
widgets, a 60 × 40 pivot, a theme with a 512 KiB logo, 1,000 selection toggles and the
query count of exact pivot totals (60 pivots over 12 datasets: 48 distinct queries,
p95 2 ms to build) and source-table detection in 12.7 KB of expert SQL with 800
references (cold median 0.9 ms / p95 1.1 ms, cached median 0.08 ms; the earlier regex
version needed 316 ms). The ODBC subscript path grows linearly (11 KB median 1.8 ms,
47 KB median 4.3 ms / p95 13.9 ms for 4.2× input) and the token cache stays at 64
statements.
Measured on Linux x86_64 (QEMU VM, 8 vCPU, 15 GB RAM, Bun 1.3.10): fan-out median
1.7 ms / p95 2.5 ms with 40 of 60 queries rebuilt and 20 untouched; pivot render median
37 ms / p95 46 ms for 2,501 cells; theme compile p95 0.07 ms; 1,000 toggles p95 1.6 ms
with 10 retained filters. The Rust `arrange` of 60 widgets over 6 pages took median
4.6 ms in a debug build. Other platforms, WebKit/WebView2 and real databases were not
measured.
