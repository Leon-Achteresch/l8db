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
  name. Charts that do not share the column are untouched and do not query again.
  Selections live in memory per dashboard and are shown as removable chips.
- **Drill-through** (`options.drill`, default on): "Details anzeigen" loads up to 200
  underlying rows (with joins only the base table's columns) with the chart's filters,
  period and selection. The dialog shows the SQL and exports CSV.
- **CSV export** of any chart's current result from the card menu.
- **Pivot** chart: rows × columns × one metric with totals (only for additive
  metrics) and optional color scale.
- **Tables**: totals row and data bars (`totals`, `dataBars`).
- **Target lines** (`target`, `targetLabel`) on line, area, column, bar and KPI charts.
- **Presentation mode** hides the editor, switches the window to fullscreen and ends
  with Esc.

## Performance

`tests/perf-dashboard-bi.test.ts` (core suite) covers cross-filter fan-out over 60
widgets, a 60 × 40 pivot, a theme with a 512 KiB logo and 1,000 selection toggles.
Measured on Linux x86_64 (QEMU VM, 8 vCPU, 15 GB RAM, Bun 1.3.10): fan-out median
1.7 ms / p95 2.5 ms with 40 of 60 queries rebuilt and 20 untouched; pivot render median
37 ms / p95 46 ms for 2,501 cells; theme compile p95 0.07 ms; 1,000 toggles p95 1.6 ms
with 10 retained filters. The Rust `arrange` of 60 widgets over 6 pages took median
4.6 ms in a debug build. Other platforms, WebKit/WebView2 and real databases were not
measured.
