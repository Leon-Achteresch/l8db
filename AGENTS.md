# AGENTS.md

Tauri v2 desktop database client (PostgreSQL viewer). Frontend: React 19 + TypeScript + Vite. Backend: Rust.

## Commands

| Task | Command | Directory |
|---|---|---|
| Dev server | `bun run tauri dev` | root |
| Production build | `bun run tauri build` | root |
| TS typecheck | `npx tsc -p tsconfig.app.json --noEmit` | root |
| Rust check | `cargo check` | `src-tauri/` |
| Rust lint | `cargo clippy` | `src-tauri/` |
| Rust format | `cargo fmt` | `src-tauri/` |
| Rust tests | `cargo test [<test_name>]` | `src-tauri/` |

No JS/TS tests, no JS linter or formatter configured.

## Toolchain

- **`bun` is required** — `tauri.conf.json` hardcodes `bun run dev` and `bun run build` as the before-dev/build hooks.
- Vite runs on port **1420** with `strictPort: true`. If that port is occupied, `tauri dev` fails.

## Routing (TanStack Router)

- Routes live in `src/routes/`. The route tree is **auto-generated** into `src/routeTree.gen.ts` by the Vite plugin on every dev/build start.
- **Never edit `src/routeTree.gen.ts` by hand.**
- `_app` prefix = pathless layout route (wraps children in `AppLayout` without adding a path segment).

## Frontend → Backend Bridge

All `invoke()` calls are centralized in `src/lib/db.ts`. TypeScript type definitions mirroring Rust structs live there — keep them in sync when changing Tauri commands.

## Backend

- `DatabaseAdapter` trait in `src-tauri/src/db/mod.rs` — extend here to add new DB engines.
- Rust enum `DatabaseKind` uses `#[serde(rename_all = "snake_case")]` — TS must send `"postgres"`.
- Postgres connections use `NoTls` — SSL is not supported.
- `fetch_table_rows` defaults to 100 rows. The `filter` string is interpolated directly into SQL (not parameterized) — be aware when modifying that code path.

## State / Storage

- Zustand store `useConnectionsStore` persists to localStorage under key `l8db.connections`.

## TypeScript Config

- `tsconfig.app.json` has `"noEmit": true` — `tsc` is typecheck-only; Vite/esbuild handles transpilation.
- Strict mode with `noUnusedLocals` and `noUnusedParameters` enabled.
- Path alias: `@` → `./src`

## Rules
- one Component per file
- NO Comments in the Code itself
