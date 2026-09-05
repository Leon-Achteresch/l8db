# l8db

A fast, native desktop client for PostgreSQL — built with [Tauri v2](https://tauri.app), React 19, and Rust.

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

- **Table browser** — browse rows with filtering, sorting, and pagination
- **Inline row editing** — edit, insert, duplicate, and delete rows with transaction support
- **Schema inspector** — columns, indexes, constraints, foreign keys, and triggers per table
- **Query editor** — Monaco-based SQL editor with syntax highlighting and formatting
- **Query history & saved queries** — automatic per-connection history (search, re-run) plus named saved queries
- **EXPLAIN visualization** — `EXPLAIN` and `EXPLAIN ANALYZE` rendered as a collapsible plan tree with costs and timings
- **SQL lint** — unknown tables in `FROM`/`JOIN` get warning markers (CTE-aware)
- **ER diagram** — visual entity-relationship diagram for a schema
- **Views** — list and edit view definitions
- **Materialized views** — list, create, refresh (standard and concurrent), and drop
- **Row Level Security** — enable/force RLS per table, manage policies (roles, USING / WITH CHECK)
- **Partitioning** — inspect partitioned tables, attach and detach partitions
- **Logical replication** — manage publications (per-table or FOR ALL TABLES) and subscriptions
- **Sessions & locks** — live `pg_stat_activity` with cancel/terminate, plus lock monitor
- **Enums** — browse, create, and drop enum types
- **Schemas** — create and drop (with optional CASCADE)
- **Database overview** — sizes per database and schema on the home dashboard
- **Functions** — browse and edit stored functions/procedures
- **Triggers** — view trigger definitions per table
- **Sequences** — list and alter sequences (start, min, max, increment, cycle, restart)
- **Extensions** — list installed extensions; install or drop them via SQL
- **Roles & privileges** — manage roles and their schema/table privileges
- **Data export** — export table data or query results as CSV or JSON
- **Transaction panel** — review and commit/rollback pending changes
- **Multiple connections** — manage and switch between connections; supports connection strings and individual fields
- **SSL / TLS** — `disable`, `prefer`, `require`, `verify-ca`, `verify-full` per connection (OS certificate store)
- **SSH tunnels** — reach private databases through a bastion (password or key auth, known_hosts verification with optional TOFU); app traffic stays end-to-end TLS-encrypted
- **OS keychain secrets** — passwords live in Keychain / Credential Manager / Secret Service, never in localStorage
- **Dark / light / system theme**

---

## Stack

| Layer    | Technology                                                |
|----------|-----------------------------------------------------------|
| Shell    | [Tauri v2](https://tauri.app) (Rust backend)              |
| Frontend | React 19 · TypeScript · Vite                              |
| Routing  | [TanStack Router](https://tanstack.com/router)            |
| Data     | [TanStack Query](https://tanstack.com/query)              |
| UI       | [shadcn/ui](https://ui.shadcn.com) · Tailwind CSS v4      |
| Editor   | [Monaco Editor](https://microsoft.github.io/monaco-editor)|
| DB       | `tokio-postgres` · `bb8` connection pool                  |

---

## Getting Started

### Prerequisites

- [Rust](https://rustup.rs/) (stable toolchain)
- [Bun](https://bun.sh/) (`bun` is required — `tauri.conf.json` hardcodes it)
- Tauri CLI v2: `cargo install tauri-cli --version "^2"`

### Development

```bash
bun install
bun run tauri dev
```

The app opens automatically. The Vite dev server runs on port **1420** (strict).

### Production build

```bash
bun run tauri build
```

Outputs an installer / app bundle in `src-tauri/target/release/bundle/`.

---

## Project Structure

```
src/
  features/          # Feature modules (one view component per feature)
    shell/           # App chrome: layout, header, sidebar, tab bar, transaction panel
    table/           # Table & view browser (data, columns, indexes, triggers)
    query/           # SQL query editor
    alter-table/     # Column management (add / alter / drop)
    sequences/       # Sequence listing and editing
    extensions/      # Extension management
    functions/       # Function/procedure browser
    triggers/        # Trigger viewer
    er-diagram/      # ER diagram canvas
    users/           # Roles & privileges
    settings/        # App settings
    home/            # Home / overview
  components/ui/     # Shared shadcn primitives
  lib/
    db.ts            # Tauri invoke() bridge (all commands)
    queries.ts       # TanStack Query hooks
    connections.ts   # Zustand connection store (persisted)
    settings.ts      # Zustand settings store (persisted)
    transactions.ts  # Transaction state
  routes/            # TanStack Router file routes (thin wrappers)

src-tauri/src/
  db/
    mod.rs           # DatabaseAdapter trait + shared types
    postgres.rs      # PostgreSQL implementation
    commands.rs      # #[tauri::command] handlers
    pool.rs          # bb8 connection pool management
    transaction.rs   # Transaction state management
  lib.rs             # Tauri builder, plugin init, command registration
  main.rs            # Entry point
```

---

## Architecture Notes

- All `invoke()` calls are centralized in `src/lib/db.ts`. TypeScript types mirror Rust structs — keep them in sync.
- `DatabaseAdapter` trait in `src-tauri/src/db/mod.rs` is the extension point for additional DB engines.
- Routes in `src/routes/` are thin: they wire `createFileRoute` to feature views. Route tree is auto-generated into `src/routeTree.gen.ts` — **do not edit it manually**.
- Connections are persisted in `localStorage` under key `l8db.connections`.
- PostgreSQL connections use `NoTls` — SSL is not supported yet.
- `fetch_table_rows` uses the configurable page size from settings (default 100). Builder-generated filters are validated server-side; raw SQL filter mode sends `allow_raw=true`.

---

## Contributing

1. Fork the repo and create a feature branch.
2. Run `cargo check` and `cargo clippy` in `src-tauri/` before committing Rust changes.
3. Run `npx tsc -p tsconfig.app.json --noEmit` to typecheck the frontend.
4. Open a pull request with a clear description of the change.

---

## License

MIT
