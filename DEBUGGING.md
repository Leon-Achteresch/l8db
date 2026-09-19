# Routine debugger

Functions, procedures and Oracle package bodies have a **Debuggen** action. The debugger uses a dedicated database session and shows server source, breakpoints, the current line, stack frames, local variables and watches. Edit the call script before starting to supply parameters, choose an overload or change a function's result type. For packages, select a member in the outline; the first member is used initially.

| Provider family | Implementation |
| --- | --- |
| Oracle | `DBMS_DEBUG`, two SQL connections; functions, procedures and package bodies |
| PostgreSQL | `pldebugger` / `pldbgapi`; PL/pgSQL functions and procedures |
| MySQL | Unavailable: no native stored-routine debugging API |
| SQL Server | Unavailable in l8db: requires a separate T-SQL debugger integration |
| Redis | Unavailable in this routine debugger: Lua LDB requires a separate adapter |
| ODBC | Unavailable: ODBC has no standardized debugger protocol; use a native provider |
| SQLite, DuckDB | No supported server-side procedural routine debugger |
| ClickHouse, MongoDB, Cassandra | No supported stored-routine debugger adapter |

Provider support is checked on the actual connection. Missing extensions, privileges and connection errors are displayed in the dialog. A failed debug start never falls back to ordinary execution.

## Oracle prerequisites

The Oracle client driver must be installed. The connected user needs `DEBUG CONNECT SESSION`, access to `SYS.DBMS_DEBUG`, and suitable execution/debug/compilation rights on the target object. Start recompiles the chosen routine or package body with `COMPILE DEBUG`; this changes its persistent compiler settings. Called routines must also have debug information for full inspection.

This implementation deliberately uses Oracle's **deprecated `DBMS_DEBUG` API**, not JDWP. It works over the same SQL transport as the database connection, including the existing SSH tunnel. It has no callback listener or additional network ACL requirement. A JDWP adapter is not implemented; deployments that disable the older API cannot use this adapter.

Oracle source lines come from `ALL_SOURCE`. Scalar local-variable candidates are discovered from declarations and then read through the debug API. This is not a complete PL/SQL symbol parser. Add a watch for names or fields not automatically discovered; unsupported values return an individual watch error. Package/global and complex collection inspection is limited by `DBMS_DEBUG.GET_VALUE` and the selected frame. Wrapped source cannot provide normal source-level navigation.

## PostgreSQL prerequisites

Install the server's `pldebugger` package, configure `plugin_debugger` in `shared_preload_libraries`, restart PostgreSQL and create `pldbgapi` in the target database. The account needs permission to use the extension and execute the routine. Hosted database services may not expose this extension.

The adapter discovers the extension schema instead of assuming `public`. It scopes its initial global breakpoint to the dedicated target backend PID. Source and line numbers come from `pldbg_get_source`, not the formatted `CREATE FUNCTION` editor text. Watches read named variables from the selected frame; arbitrary SQL expression evaluation is not provided. Step Out is implemented through successive Step Over operations until the stack unwinds, another breakpoint is reached or the step/time limit is exceeded.

## Execution and lifecycle

- F5 starts or continues, F10 steps over, F11 steps into, Shift+F11 steps out, Shift+F5 stops.
- Breakpoints are scoped to the debugger session. They can be changed while paused, including inside nested routines.
- The call runs with autocommit disabled or inside an explicit transaction. Open transactions are rolled back on normal completion and cancellation. Explicit commits, autonomous transactions and Oracle DDL cannot be undone by this cleanup. PostgreSQL procedures that perform transaction control may reject the explicit transaction wrapper.
- Database errors are shown in the session. A variable watch cannot execute arbitrary SQL. Returned result sets and a live `DBMS_OUTPUT`/notice console are not currently exposed by the debugger.
- Closing the dialog stops the session. After four minutes without a debugger command, an idle session is stopped; polling does not extend this period. Commands have bounded waits. At most sixteen sessions may be registered at once.
- Connection identity is checked for every session command. The existing effective connection URL, TLS policy, proxy-user settings and SSH behavior are retained. Read-only connections cannot launch or advance execution; stopping remains available.

## Verification

Normal checks:

```sh
bun run test
bun run check
bun run build
bun run production:check
cargo test --manifest-path src-tauri/Cargo.toml --lib
cargo clippy --manifest-path src-tauri/Cargo.toml --lib
```

Live tests use dedicated PostgreSQL and Oracle test databases. Set `L8DB_DEBUG_PG_URL` and `L8DB_DEBUG_ORACLE_URL` outside source control. The Oracle tests expect a test account/schema named `L8DB_DEBUG` with CREATE PROCEDURE and the debug privileges above. PostgreSQL needs `pldbgapi`. The tests create objects named `l8db_debug_*`.

```sh
cargo test --manifest-path src-tauri/Cargo.toml --lib db::debugger -- --include-ignored --test-threads=1
```

Browser regression tests use the real application components with mocked Tauri transport. Start Vite on port 1420, install Playwright Chromium once, then run:

```sh
bunx playwright install chromium
L8DB_DEBUG_BROWSER=1 bun test tests/debugger-browser.test.ts
```

The live Rust tests validate the database protocol separately; browser mocks do not establish actual server compatibility.
