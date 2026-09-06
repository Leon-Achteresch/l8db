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
| Rust E2E tests (needs lab, see below) | `cargo test --lib -- --ignored --test-threads=1` | `src-tauri/` |

Frontend regression tests: `bun run test` (Bun, in `tests/`, mocked Tauri transport).
Biome is installed; the existing root `biome.json` contains legacy configuration keys and needs migration before the root lint/format scripts can be used.

## Toolchain

- **`bun` is required** — `tauri.conf.json` hardcodes `bun run dev` and `bun run build` as the before-dev/build hooks.
- Vite runs on port **1420** with `strictPort: true`. If that port is occupied, `tauri dev` fails.

## Routing (TanStack Router)

- Routes live in `src/routes/` and stay thin: they only wire `createFileRoute` to a view in `src/features/`.
- The route tree is **auto-generated** into `src/routeTree.gen.ts` by the Vite plugin on every dev/build start.
- **Never edit `src/routeTree.gen.ts` by hand.**
- `_app` prefix = pathless layout route (wraps children in `AppLayout` without adding a path segment).

## Frontend structure

- `src/features/` — feature modules (views + feature-specific UI). One exported React component per file; main route entry is `{feature}-view.tsx`.
- `src/features/shell/` — app chrome (`app-layout`, `table-tabs`, `app-header`, `transaction-panel`).
- `src/components/ui/` — shared shadcn primitives only.

## Frontend → Backend Bridge

All `invoke()` calls are centralized in `src/lib/db.ts`. TypeScript type definitions mirroring Rust structs live there — keep them in sync when changing Tauri commands.

## Backend

- Provider pattern: `src-tauri/src/db/provider.rs` is the registry (`DatabaseKind` families, `Capabilities` per family, `PROVIDERS` product list with driver info, `driver_status`). One adapter file per family (`postgres.rs`, `mysql.rs`, `sqlite.rs`, `mssql.rs`, `clickhouse.rs`, `mongodb.rs`, `redis.rs`, `oracle.rs`, `cassandra.rs`, `duckdb.rs`, `odbc.rs`), dispatched in `create_adapter_from_string` in `mod.rs`. See `docs/providers.md` for how to add providers and families.
- `DatabaseAdapter` trait in `src-tauri/src/db/mod.rs`: only `test_connection`, `list_databases`, `list_schemas`, `list_tables`, `list_columns`, `fetch_rows`, `count_rows`, `execute_query` are required; every other method defaults to `Err(unsupported(..))`. Shared helpers live in `mod.rs`; shared clients per connection key via `PoolManager::shared::<T>()`.
- Rust enum `DatabaseKind` uses `#[serde(rename_all = "snake_case")]` — TS `DatabaseKind` in `src/lib/db.ts` must mirror it.
- DuckDB and ODBC are optional Cargo features (`--features duckdb`, `--features odbc`); without them the registry reports the driver as unavailable.
- Frontend gating: `src/lib/providers.ts` loads the registry at startup (`loadProviders()` in `main.tsx`); use `useActiveCapabilities()` / `supports(connection, feature)` instead of hardcoding kinds. URL parsing and provider detection are registry-driven in `src/lib/connection-url.ts`.
- Postgres connections use `postgres-native-tls` (OS certificate store); per-connection `ssl_mode` (`disable`/`prefer`/`require`/`verify-ca`/`verify-full`), parsed from `?sslmode=` in connection strings.
- SSH tunnels (`src-tauri/src/db/ssh.rs`, `russh`): local port-forward per connection id; frontend opens the tunnel on activation/test and talks to `127.0.0.1:<port>` via `effectiveConnectionString()` (`src/lib/ssh.ts`). Never add a direct-connect fallback — a failed tunnel must fail loudly.
- Secrets live in the OS keychain (`store_secret`/`load_secret`/`delete_secret`); `connectionString` in the store is the *direct* URL, `tunnelPort` is memory-only, `effectiveConnectionString()` resolves the usable URL. All `invoke()` call sites must use the effective URL.
- `fetch_table_rows` defaults to 100 rows. Simple (builder-generated) filters are validated server-side (`validate_table_filter`: string literals are stripped, then `; -- /* */ UNION RETURNING INTO` are rejected); explicit raw SQL sets `allow_raw=true` (`fetch_table_rows`/`count_table_rows`, threaded from the SQL filter modes via `filterRaw`/`fkRaw`).
- `smoke_adapters_from_env` (ignored) exercises every adapter whose `L8DB_SMOKE_<KIND>_URL` env var is set (see `docs/providers.md`).
- Ignored Rust tests under `#[ignore]` need a local lab: Postgres 18 on `127.0.0.1:5433` (`postgres`/`testpw`, db `testdb`, `wal_level=logical`; override via `L8DB_E2E_PG_URL`) plus OpenSSH on `127.0.0.1:2222` (root login, provider hostname `l8db-pg`; overrides `L8DB_E2E_SSH_HOST`/`_PORT`, client key via `L8DB_E2E_KEY_FILE`, isolated known_hosts via `L8DB_KNOWN_HOSTS`). Subscription tests create a `testsub` database and clean up after themselves; `connect=false` keeps CREATE SUBSCRIPTION deterministic (no worker timing).

## State / Storage

- Zustand store `useConnectionsStore` persists to localStorage under key `l8db.connections`.

## TypeScript Config

- `tsconfig.app.json` has `"noEmit": true` — `tsc` is typecheck-only; Vite/esbuild handles transpilation.
- Strict mode with `noUnusedLocals` and `noUnusedParameters` enabled.
- Path alias: `@` → `./src`

## Rules
- one Component per file
- NO Comments in the Code itself
