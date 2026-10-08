# App design and activation

The app uses one shared visual system for its shell, connection setup, database workspace, settings, dialogs, forms, and empty states. `src/styles/workspace.css` is loaded after the existing stylesheet. It preserves provider accent hues and appearance settings while using quieter backgrounds, clearer surface boundaries, smaller corner radii, consistent focus states, and less decorative shadowing.

## First useful result

First run offers **Direkt loslegen** and **Erst einrichten** immediately. Starting with the current defaults only sets `onboardingDone`; it does not enable diagnostic sharing, install extensions, change the theme, or change the workspace mode. The existing setup wizard remains available through the second action and through settings. Keyboard focus begins on the primary action, cycles between the two choices, and Escape opens the workspace. The quick-start feature is registered as `connections.onboarding.quick-start`, with visibility attached to the actual button.

The connection welcome view prioritizes connecting a database, followed by pasting a URL, opening a local file, and importing existing profiles. Help remains available, while the longer keyboard reference is collapsed by default. The connected home view gives the new-query action priority and places disconnect beside connection status. Navigation labels appear in sufficiently wide windows; smaller windows retain the compact rail and its tooltips. Query empty states use the configured execution shortcut. Errors lead with recovery actions and disclose technical detail on request.

These changes aim to shorten the path to a successful connection and useful query. They do not establish a measured improvement in activation or retention, and the desktop app has no trial signup flow.

## Validation

With a running Vite server and no concurrent UI edits:

```sh
L8DB_APP_DESIGN_BROWSER_URL=http://localhost:1420 bun test tests/app-activation-design.test.ts tests/perf-app-activation.test.ts
```

The preview fixture at `/tests/fixtures/app-activation.html` runs the real app with mocked Tauri commands. `mode=onboarding` shows first run, `mode=welcome` shows the connection welcome view, and the default provides a connected database with 3,000 tables. `route` and `tables` can be provided as query parameters. This fixture is test infrastructure and is excluded from the normal app entrypoint.

Functional coverage includes immediate start, optional personalization, keyboard focus, unchanged privacy choices, connection-editor entry and exit, query navigation, active navigation, and horizontal overflow at 900, 1,280, and 1,600 pixels, light/dark themes, and 100%/150% UI scale. TypeScript and scoped Biome checks pass.

## Performance evidence

The previous intro's source used a 5,400 ms automatic transition, 40 animated particles, and repeating decorative animations before entering five setup steps. Clicking or pressing a supported key could skip the intro. This is a source-derived baseline, not a measurement of the old binary on this platform. The new intro has no automatic advance or repeating decorative animations and lets users bypass setup. Short focus/color transitions and feature-badge visibility tracking remain.

Measured on Linux x64, QEMU Virtual CPU 2.5+, 8 logical CPUs, 15.62 GiB RAM, Bun 1.3.10, Chromium 153.0.8010.12, with the Vite development app and mocked PostgreSQL metadata. No CPU or heap throttling was applied. Other sessions were active on this machine.

Workload: a connected workspace containing 3,000 tables, with 11 rapid onboarding entry/exit cycles, the first two excluded from latency samples, followed by 1.5 seconds idle and a user-triggered exit.

| Measurement | Observed | Regression limit |
|---|---:|---:|
| Intro becomes usable, median | 40.4 ms | Recorded |
| Intro becomes usable, p95 | 47.6 ms | < 120 ms |
| Intro descendant elements | 92 | < 120 |
| Total elements after exit | 1,248 | < 1,600 |
| Retained intro elements after exit | 0 | 0 |
| Retained intro animations after exit | 0 | 0 |
| Animations inside intro after idle | 0 | 0 |
| Database requests during idle interval | 0 | 0 |

Metadata request counts during this scenario were: schemas 1, databases 1, tables 2, functions 2, views 2, database overview 1. The fixture returns immediately and does not model real database latency or database-server concurrency. DOM counts establish bounded rendering for this scenario, not a heap measurement.

Missing coverage: native Tauri windows, real macOS/Windows hardware, WebKit, other database families, real database servers, constrained CPU/heap profiles, and production-bundle performance. No performance budget was increased.
