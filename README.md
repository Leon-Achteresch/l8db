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
- **ER diagram** — visual entity-relationship diagram for a schema
- **Views** — list and edit view definitions
- **Functions** — browse and edit stored functions/procedures
- **Triggers** — view trigger definitions per table
- **Sequences** — list and alter sequences (start, min, max, increment, cycle, restart)
- **Extensions** — list installed extensions; install or drop them via SQL
- **Roles & privileges** — manage roles and their schema/table privileges
- **Data export** — export table data or query results as CSV or JSON
- **Transaction panel** — review and commit/rollback pending changes
- **Multiple connections** — manage and switch between connections; supports connection strings and individual fields
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
- `fetch_table_rows` uses the configurable page size from settings (default 100). The filter string is interpolated directly into SQL — not parameterized.

---

## Contributing

1. Fork the repo and create a feature branch.
2. Run `cargo check` and `cargo clippy` in `src-tauri/` before committing Rust changes.
3. Run `npx tsc -p tsconfig.app.json --noEmit` to typecheck the frontend.
4. Open a pull request with a clear description of the change.

---

## License

MIT
