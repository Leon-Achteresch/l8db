# Dashboard design

Open **Dashboard → Design** to edit a dashboard's CSS. The editor supports `.css`
file import, CSS export, three editable starting designs, live preview, an enabled
switch, reset, discard and apply. Import replaces the draft; it does not immediately
overwrite the saved dashboard. Apply saves the design with the existing dashboard
history and persistence. Dashboard JSON export/import, duplication, multi-window
sync and MCP sync preserve it.

There is no property whitelist: use the CSS supported by the installed WebView,
including typography, backgrounds, gradients, borders, shadows, layout, SVG,
tables, pseudo-elements, nesting, media/container/supports queries and animations.
CSS is limited to 256 KiB of UTF-8 per dashboard. Stylesheet declarations are parsed
by the browser and scoped with native `@scope`; this requires a WebView that
supports that rule. `:root`, `:scope` and `.dashboard-surface` address this
dashboard's root, including its toolbar and filters. Portal menus rendered outside
the dashboard are outside the scope.

Imported CSS text is embedded in the dashboard, not linked to the source file.
`@import` is not loaded. Embed required rules in the imported file. External image
and font URLs remain subject to the app's existing CSP; relative URLs resolve
against the app, not the imported file's directory. Name-defining rules such as
`@keyframes`, `@font-face`, `@property` and `@layer` can define global names, so use
unique names per dashboard. This follows the
[CSS scoping specification](https://www.w3.org/TR/css-cascade-6/#scoped-styles).

## Selectors

| Selector | Element |
| --- | --- |
| `.dashboard-surface` | Dashboard root |
| `.dashboard-toolbar` | Toolbar |
| `.dashboard-filters` | Shared filters |
| `.dashboard-canvas` | Scrollable canvas |
| `.dashboard-grid` | Grid layout |
| `.dashboard-widget` | Chart card, including placeholders |
| `.dashboard-widget-header` | Card header |
| `.dashboard-widget-title` | Title |
| `.dashboard-widget-subtitle` | Subtitle |
| `.dashboard-widget-summary` | Headline and legend |
| `.dashboard-widget-content` | Chart/table content |
| `[data-chart-type="kpi"]` | Grid item for a chart type |
| `[data-widget-id="chart-id"]` | One grid item |

Use any descendant selector, SVG selector, state pseudo-class or pseudo-element.
Example:

```css
:root {
  --dash-accent: #8b5cf6 !important;
  --dash-color-1: #8b5cf6;
  --dash-color-2: #22d3ee;
}

.dashboard-widget {
  border-radius: 24px;
  box-shadow: 0 8px 30px #0002;
}

[data-chart-type="kpi"] .dashboard-widget-title {
  font-size: 18px;
}
```

Chart variables include `--dash-accent`, `--dash-color-1` through `--dash-color-8`,
`--dash-compare` and `--dash-compare-mark`. Theme variables include `--background`,
`--foreground`, `--card`, `--border` and `--muted-foreground`. The vivid palette sets
`--dash-accent` inline; use `!important` to override it.

The design editor sits outside the styled dashboard. **Ctrl/Cmd + Shift + D**
opens it and temporarily suspends custom CSS in this window. Change the draft or
apply to resume styling. This also recovers a dashboard hidden with `display:none`.
**Ctrl/Cmd + Enter** in the CSS field applies the draft.

## AI and MCP

Enter a design request and choose **Design mit KI ändern**. The current dashboard
and draft are registered for MCP synchronization, and the existing AI workspace
opens with the request, dashboard ID, CSS and selector guide. Send the prepared
request using the configured AI provider. The assistant can read the current design
with `dashboard` action `get` and change only the design with `update`:

```json
{
  "action": "update",
  "dashboard": "dashboard-id",
  "design": {
    "css": ".dashboard-widget { border-radius: 24px; }",
    "enabled": true
  }
}
```

`create` also accepts `design`; `design: null` resets it. Updates retain datasets,
charts, filters and layout and do not execute database queries. Existing AI tool
approval and connection visibility rules continue to apply.

## Scoped regression checks

```sh
bun test tests/dashboard-design.test.ts tests/dashboard-file.test.ts tests/mcp-dashboards.test.ts
L8DB_DASHBOARD_DESIGN_BROWSER_URL=http://localhost:1420 bun test tests/dashboard-design-browser.test.ts tests/perf-dashboard-design.test.ts
cd src-tauri && cargo test mcp::dashboard -- --nocapture
```

The browser fixture has 60 cards. The performance scenario compiles and applies
5,000 CSS rules (193,889 source bytes), forces style resolution, measures 20 samples
after two warmups, and exercises 1,000 rapid edits, idle behavior and disposal of a
pending update. Budgets: median <50 ms, p95 <100 ms, compiled CSS <1.5 MB, one
retained style marker/rule group/adopted stylesheet, one application for the edit
burst, no idle or abandoned applications, no remaining style after disposal and zero database
requests. Source size and retained DOM are measured bounds, not a native heap
measurement. The previous serialized stylesheet implementation measured Chromium
18.70/29.60 ms and WebKit 108/121 ms (median/p95). Reusing a constructed stylesheet
with `document.adoptedStyleSheets` removes the second parse of serialized CSS.
Only selectors containing dashboard root aliases need CSSOM mutation. The resulting
measurement was **Chromium 16.60/26.10 ms** and **WebKit 85/97 ms** (median/p95).
Serialized compiled CSS was 283,926 bytes. Both engines retained one
stylesheet/rule group, applied the 1,000-edit burst once, recorded zero idle/abandoned applications and database
requests, and removed the stylesheet on disposal.

**Known budget failure:** WebKit exceeds the unchanged 50 ms median latency budget
for this large stylesheet; its p95 meets the 100 ms budget. The final WebKit stage
medians were 26 ms to compile, 0 ms to adopt and 62 ms for forced style resolution.
The scoped performance test fails on that engine; this is not a passing cross-platform performance claim.
Chromium meets the budgets. Live edits remain debounced by 180 ms, and unchanged
CSS does not cause another style update.

Rust additionally tests the same 5,000-rule update workload, with 20 measured
updates after two warmups, unchanged chart data, one retained dashboard file and a
512 KiB file limit. Measured median/p95: **22.73/31.74 ms**, within the 50/100 ms
budgets.

Environment: Linux x86_64 VM, eight QEMU Virtual CPU version 2.5+ logical CPUs,
16,775,348,224 bytes RAM, Bun 1.3.10, Chromium 153.0.8010.12 and WebKit 26.6.
These are actual Linux VM measurements, not CPU/heap simulation. macOS, Windows,
real desktop WebViews, Firefox, constrained profiles and live database families
were not exercised. Browser database request counts use the fixture's mocked
Tauri transport; the Rust lifecycle check verifies design updates still work with
an inaccessible database URL. No live AI provider was called.

The final functional browser audit passed in Chromium and WebKit (62 assertions
across both engines). It verifies imported CSS, draft discard, export, persisted
reload, root variables, nested and responsive selectors, pseudo-elements,
registered `@font-face` definitions, running `@keyframes` animations, typography,
scope isolation, hidden-dashboard recovery and the AI/MCP handoff. Additional
checks cover escaped root selectors, custom-property tokens containing braces,
invalid-draft rollback, independent stylesheet ownership and idempotent disposal.
A deliberately delayed file read also verifies that choosing a newer preset cancels the stale
import; typing, reset and the enabled switch use the same cancellation mechanism.
This audit establishes the requested design capabilities within the documented
WebView and resource constraints. The separate large-stylesheet WebKit latency
failure above remains open.
