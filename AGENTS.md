# AGENTS.md

Tauri v2 desktop database client with multiple database families. Frontend: React 19 + TypeScript + Vite. Backend: Rust.

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
| PostgreSQL/SSH integration (Docker) | `bun run test:integration` | root |
| Rust E2E tests (needs lab, see below) | `cargo test --lib -- --ignored --test-threads=1` | `src-tauri/` |

Frontend regression tests: `bun run test` (Bun, in `tests/`, mocked Tauri transport).
Biome is configured; run `bun run check` for frontend lint and formatting checks.
Production configuration checks: `bun run production:check`. CSP browser tests: build first, then run `L8DB_PRODUCTION_BROWSER=1 L8DB_EXTENSION_BROWSER=1 bun test tests/production-browser.test.ts tests/extension-browser.test.ts` (use `webkit` instead of `1` for WebKit).
Use Bun 1.3.10 and commit `bun.lock`; do not add an npm lockfile.

## Checks for coding agents

Keep checks fast: run only what the change can break, once at the end, not after every edit.

| Changed | Run |
|---|---|
| Docs, copy, CSS/Tailwind only | nothing |
| `src/**/*.ts(x)` | `npx tsc -p tsconfig.app.json --noEmit`, `bunx biome check <changed files>`, and only the tests that cover the change (`grep -l <module> tests/*.test.ts`) |
| `src-tauri/**/*.rs` | `cargo check`, plus `cargo test <module>` if logic changed |

- Do not run unless the user asks or `/release` requires it: full `bun run test`, `cargo clippy`, full `cargo test`, browser/perf/integration/E2E tests, `production:check`, `tauri build`.
- Do not re-run a check that already passed, and do not wait for CI.
- If a check fails for reasons unrelated to your change, report it instead of fixing it.

## Git & Releases

- Daily work happens directly on `development`; `development` publishes nothing. Do not create worktrees or switch branches in a checkout used by other agents. Existing feature branches are integrated with `merge --no-ff` from a separate, clean clone on `development`.
- Before starting any change, synchronize `development` using the parallel-work protocol below. When a change is finished, commit only your changes and push to `origin/development` using that protocol.
- Canary: every push to `canary` publishes a GitHub pre-release `vX.Y.Z-canary.N` (never "Latest"). `/canary` (`.claude/skills/canary/SKILL.md`) fast-forwards `canary` to `development` after confirmation; never force-push or commit directly to `canary`.
- Stable: every push to `main` publishes `vX.Y.Z`. `/release` (`.claude/skills/release/SKILL.md`) opens or updates the PR `canary` → `main`; it is merged with a merge commit, never squashed. No release branches, no version PR, no back-merge, except after a hotfix (`fix/*` from `main` → PR → `main`): merge `main` into `development` right away, then run `/canary`.
- Versions come from Conventional Commits since the last stable tag (`feat` → minor, `fix`/`perf` → patch, `!`/`BREAKING CHANGE:` → major, minor before 1.0; anything else alone releases nothing). Canary `N` counts per target version. The version in `package.json`/Cargo/`tauri.conf.json` and `CHANGELOG.md` are set only inside the release runners and are not maintained in the repo; see `.github/RELEASING.md`. Commit messages must use Conventional Commit prefixes.
- Users pick the update channel (Stable/Canary) in Settings → About; both channels check through `check_update` (`src-tauri/src/updates.rs`, wrapper `src/lib/db/updates.ts`).

## Parallel agents / instances (no worktrees)

These rules apply to every agent, including agents in other app instances. All tasks finish committed and pushed to `origin/development`. Parallel work must preserve every other task's changes and behavior.

### Shared checkout: reserve files and serialize Git

- At task start, read `git status --short --branch`, the current diff, and `.git/agent-coordination.md` if it exists. Treat all pre-existing changes, staged files, untracked files, and deletions as another task's work unless ownership is explicitly handed over. Record your task scope and the behavior that must survive integration.
- Use the same persistent lock file for all agents in this checkout: `.git/agent-coordination.lock`. Acquire it with `flock` for every Git operation that changes the index, refs, or working tree, including fetch, pull, add, commit, merge, and push, and for every update to the coordination file. Git's own `index.lock` does not protect a sequence of commands. Never delete or replace the coordination lock file.
- Example: `flock -w 30 .git/agent-coordination.lock bash -c 'git fetch origin && git -c rebase.autoStash=false -c merge.autoStash=false pull --ff-only origin development'`. Hold one lock for the entire operation, including inspection, staging, staged-diff review, commit, and push when finishing. Each shell invocation releases its lock when it exits; a lock from an earlier tool call is no longer held. On timeout, wait and retry; never bypass the lock.
- Under the lock, register a unique task/instance ID, the exact reserved paths, and status in `.git/agent-coordination.md` before editing. Create this local, uncommitted Markdown table if absent. Check existing reservations before adding yours. Reservations include new files, deletions, renames, shared registries, manifests, lockfiles, and files rewritten by generators or formatters. A directory reservation covers its descendants.
- Only edit paths reserved by your task. Keep reservations until your changes are committed; do not reserve a file with another task's uncommitted changes. Tasks touching the same file run sequentially, even when they intend to edit different lines. Wait for the owner to finish or arrange an explicit handover; meanwhile, continue independent work. Expand reservations under the lock before expanding scope. Do not remove another task's reservation merely because it is old; confirm that the task has ended and account for its remaining changes first.
- Work concurrently on disjoint reserved files. Re-read a file immediately before editing and apply focused changes to its current contents. Do not overwrite files from an earlier snapshot. Run formatters only on owned files; reserve every affected file before running a tool that writes multiple files. The coordination file stays in `.git/`, never in a feature commit.

### Synchronization and commits

- At startup, under the lock, verify the branch is `development`, fetch `origin`, and use `git -c rebase.autoStash=false -c merge.autoStash=false pull --ff-only origin development` when the checkout can safely advance. If already current, existing unrelated changes may remain. If advancing would affect uncommitted work, wait for its owners to commit; never stash their work or force the update. If local and remote history have diverged, merge as described below. Never switch a shared checkout away from `development`.
- Never use `git add .`, `git add -A`, `git commit -a`, broad cleanup, `reset --hard`, `clean`, forced checkout/restore, automatic stashing, history rewriting, or force-push to get a clean checkout. Do not undo, delete, stage, or commit another task's changes. An unexpected dirty file is evidence of concurrent work, not permission to remove it.
- Run the required checks for your change while retaining your reservations. Before committing, acquire the Git lock, verify the branch again, and inspect the current status and diff. The index must be empty before staging; if another task left staged changes, wait for that task to handle them. Stage only explicit owned paths with `git add -- <paths>`, review `git diff --cached` and `git diff --cached --name-status`, and commit with a Conventional Commit message. If a file contains changes from another owner, resolve ownership before staging it.
- Fetch again before pushing. If `origin/development` is ahead or divergent, integrate it with a normal merge, preserving both histories. Merge only when the working tree and index are clean; in a shared checkout, wait for other tasks to commit their pending work first. Do not use rebase or autostash. A rejected push means fetch, merge, check the affected behavior, and retry `git push origin development`; never replace the remote history.
- Resolve conflicts by preserving the intent and working behavior of both tasks. Do not select entire files with `--ours` or `--theirs` or drop a feature to make checks pass. Review both commits, combine their changes, and check each affected task's acceptance criteria. Coordinate with the owner if the intended behavior is unclear. Repeat checks only when integration changes or invalidates the already checked code.
- After your commit, update your reservation status under the lock so others can use those paths. If synchronization is waiting on other tasks, release the Git lock before waiting so they can finish. Retain a record of the commit and mark the task complete only after it is reachable from the fetched `origin/development`. Report the commit, relevant checks, and any unresolved dependency. Other agents' dirty files may remain; do not claim the whole checkout is clean while they are working.

### Separate clones / machines

- Separate instances sharing this checkout use the same lock and reservations above. Instances with independent clones cannot coordinate through a local `.git/` file: a local lock does not serialize remote pushes or edits in another clone.
- In independent clones, still work directly on `development`, fetch before starting and before pushing, and commit only the assigned task. Coordinate overlapping task scopes through the shared task channel before editing; if no such channel exists, keep overlapping work sequential. Recover from concurrent pushes by merging the latest `origin/development`, resolving conflicts without losing either feature, checking the integrated result, and retrying a normal push.
- No task is finished merely because its local commit exists. Its commit and intended feature must survive integration and be present on `origin/development`.

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

## NEW badges for features

- Register every new user-facing feature in `NEW_FEATURES` in `src/lib/new-features.ts` with a stable hierarchical ID for its navigation path and the app version that introduces it.
- Attach the feature ID to its actual UI element with `SettingsRow.featureId` or `useNewFeatureVisibility()`. Navigation badges derive from the ID; navigation alone must not mark the feature as seen. See `docs/new-feature-badges.md`.

## Frontend → Backend Bridge

All `invoke()` calls are centralized in `src/lib/db/`. TypeScript type definitions mirroring Rust structs live there — keep them in sync when changing Tauri commands.

## Backend

- Provider pattern: `src-tauri/src/db/provider.rs` is the registry (`DatabaseKind` families, `Capabilities` per family, `PROVIDERS` product list with driver info, `driver_status`). One adapter file per family (`postgres.rs`, `mysql.rs`, `sqlite.rs`, `mssql.rs`, `clickhouse.rs`, `mongodb.rs`, `redis.rs`, `oracle.rs`, `cassandra.rs`, `duckdb.rs`, `odbc.rs`), dispatched in `create_adapter_from_string` in `mod.rs`. See `docs/providers.md` for how to add providers and families.
- `DatabaseAdapter` trait in `src-tauri/src/db/mod.rs`: only `test_connection`, `list_databases`, `list_schemas`, `list_tables`, `list_columns`, `fetch_rows`, `count_rows`, `execute_query` are required; every other method defaults to `Err(unsupported(..))`. Shared helpers live in `mod.rs`; shared clients per connection key via `PoolManager::shared::<T>()`.
- Rust enum `DatabaseKind` uses `#[serde(rename_all = "snake_case")]` — TS `DatabaseKind` in `src/lib/db/` must mirror it.
- DuckDB (bundled) and ODBC are default Cargo features. ODBC uses odbc-api's `vendored-unix-odbc`: unixODBC is compiled and linked statically on macOS/Linux, so the app never links `libodbc` dynamically (Windows links the system `odbc32`). `--no-default-features` drops both; the registry then reports the driver as unavailable.
- File open (`src-tauri/src/file_open.rs`): argv (`l8db <path>`, `l8db --file <path>`), macOS `RunEvent::Opened`, the single-instance plugin (release builds only) and drag & drop map paths to actions (SQLite/DuckDB/CSV/Parquet → temporary connection, `.sql` → editor tab, `.l8nb` → notebook). Actions are queued in `PendingOpenFiles` and drained by the frontend (`take_pending_open_files`, event `open-files`). Temporary connections (`temporary: true`) are never persisted until "Verbindung speichern".
- Multiple windows (`src-tauri/src/windows.rs`): `open_app_window` opens `win-<n>` (blank, `?window=1`) or `conn-<id>` (`?connection=<id>`, activated on startup via `activateConnectionWithToast`); every window reuses the `main` window config. `WindowConnections` tracks each window's active connection so switching never closes a tunnel another window still uses. Quick actions (new window, new query, manage connections, recent connections from `set_dock_recents`) appear in the macOS Dock menu (`applicationDockMenu:` added to tao's delegate) and the Windows taskbar jump list (`ICustomDestinationList`, untested on real Windows). Jump list entries relaunch the exe with `--menu=dock.<action>`, `l8db --new-window` backs the Linux desktop action; both reach the running app via the single-instance plugin (release builds only). All windows share one `localStorage`: persisted stores holding user data must call `syncAcrossWindows(key, …)` (`src/lib/window-sync.ts`), otherwise one window silently overwrites another's changes.
- Frontend gating: `src/lib/providers.ts` loads the registry at startup (`loadProviders()` in `main.tsx`); use `useActiveCapabilities()` / `supports(connection, feature)` instead of hardcoding kinds. URL parsing and provider detection are registry-driven in `src/lib/connection-url.ts`.
- Postgres connections use `postgres-native-tls` (OS certificate store); per-connection `ssl_mode` (`disable`/`prefer`/`require`/`verify-ca`/`verify-full`), parsed from `?sslmode=` in connection strings.
- SSH tunnels (`src-tauri/src/db/ssh/`, `russh`): local port-forward per connection id; frontend opens the tunnel on activation/test and talks to `127.0.0.1:<port>` via `effectiveConnectionString()` (`src/lib/ssh/`). Auth: password, key or agent; optional ProxyJump chain and SOCKS5/HTTP proxy; proxy-only connections use the same local-port model (`open_proxy_tunnel`, `usesTunnel()`). Never add a direct-connect fallback — a failed tunnel must fail loudly. See `docs/ssh-network.md`.
- Secrets live in the OS keychain (`store_secret`/`load_secret`/`delete_secret`); `connectionString` in the store is the *direct* URL, `tunnelPort` is memory-only, `effectiveConnectionString()` resolves the usable URL. All `invoke()` call sites must use the effective URL.
- `fetch_table_rows` defaults to 100 rows. Simple (builder-generated) filters are validated server-side (`validate_table_filter`: string literals are stripped, then `; -- /* */ UNION RETURNING INTO` are rejected); explicit raw SQL sets `allow_raw=true` (`fetch_table_rows`/`count_table_rows`, threaded from the SQL filter modes via `filterRaw`/`fkRaw`).
- Object storage: the `s3` family (`src-tauri/src/db/s3/`) sets the `object_storage` capability. Its UI lives in `src/features/storage/` and talks to dedicated `s3_*` commands (`src/lib/db/storage.ts`); the generic adapter only maps buckets to tables for SQL/MCP. MinIO lab: `scripts/minio-lab.sh` (see `docs/providers.md`).
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
