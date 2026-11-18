# Integration tests

Run `bun run test:integration` with Docker, Docker Compose, Rust and OpenSSH client tools installed. The script creates an isolated Compose project, starts PostgreSQL 18, two OpenSSH servers (target `l8db-ssh` and a jump host), a SOCKS5 proxy (`serjs/go-socks5-proxy`) and an HTTP CONNECT proxy (tinyproxy) with health checks, uses random localhost ports, generates temporary client keys, two throwaway `ssh-agent` sockets and a known_hosts file, runs the selected Rust tests serially and removes containers, volumes and key files on exit. Failed runs print service logs. No user database is used.

The mandatory suite covers table transactions, CSV import rollback, confirmed PostgreSQL cancellation, password/key/agent SSH authentication (including an agent without a matching key), ProxyJump chains with host key checks on the inner hop, SSH via SOCKS5/HTTP proxy, direct database connections through the proxy forwarder, rejected proxy credentials, rejected authentication and unknown host keys, and CSV cursor export boundaries/cancellation. A missing service or missing required key fails the run. Other ignored tests need their own fixtures and are deliberately excluded.

CI invokes the same script. For repeatability, run it twice; each invocation provisions fresh services. Run `L8DB_LAB_TEST_UNREACHABLE=1 bun run test:integration` to verify the failure path: the required PostgreSQL URL is replaced with an unreachable localhost port. The suite must fail and remove all lab resources. This negative check was verified locally.

Run `bun run build && bun run test:browser` for the mandatory existing browser regressions. The runner starts and closes its own Vite fixture server, supplies all required test switches and runs table editing, table state (Chromium/WebKit), query workspace, QoL and comparison tests. Diagnostics are saved under `test-artifacts/browser`; CI uploads them and existing screenshots. The production CSP/extension suite remains separate.

## PostgreSQL array editor: owned local provider integration (A01)

```sh
bash scripts/test-postgres-arrays-local.sh
```

Requires local `initdb`, `pg_ctl`, `createdb`, Python 3 and Rust. The scoped script
creates a fresh cluster/database with a unique marker, listens only on 127.0.0.1
at an ephemeral port and disables Unix sockets. It uses 16 MiB shared buffers and
at most 12 connections; Cargo uses at most 2 jobs. No Docker/container or saved
connection is opened. Provisioning uses an empty isolated libpq profile and
explicit host/port/user; the Rust test requires its dedicated loopback DSN and
verifies database, user and cluster marker before creating synthetic fixtures.
No ordinary lab URL, environment fallback or user database is accepted.

The ignored scoped Rust test calls the actual `PostgresAdapter` catalog,
`fetch_rows` decoder and `update_row`, plus `TransactionManager` update/commit/
rollback. Thirteen cases run through each write mode: scalar/enum arrays, escaped
text, NULL/empty values, exact numeric JSON text, 1D/2D and negative/nonstandard
bounds, adding a dimension, array-domain casts and explicit PostgreSQL bounds.
Values and bounds are read back from PostgreSQL; an observer verifies uncommitted
changes remain invisible and rollback preserves the original row and bounds.

Sixteen malformed/ragged/NUL/unsupported JSON-, composite- and element-domain
attempts include another changed field. Both the full original row and a
nontransactional BEFORE UPDATE sequence remain unchanged, proving rejection
before UPDATE rather than merely an eventual rollback. No unsupported notation
was enabled to make the test pass. Precise numeric arrays deliberately return as
raw JSON text in the grid, and ordinary query-result cells may be textual values.

The script removes only its own cluster/directory on success, failure or signals.
Output is retained under `test-artifacts/a01-local-postgresql.log`; budgets are
documented in `docs/performance.md`. Verified locally with PostgreSQL 17.11 on
macOS arm64. This is a real native-provider integration test, not a mocked SQL
assertion or a Tauri/editor visual walkthrough. Other providers, PostgreSQL
versions, platforms and native visual acceptance remain separate.

### A01 isolated editor / IPC development

With Bun1.3.10 and local PostgreSQL binaries on PATH:

```sh
bash scripts/test-postgres-arrays-local.sh --editor
```

The explicit debug-only `--array-editor-development` entry opens a fresh incognito WebView before ordinary storage, connections, secrets, CLI/automation or background services initialize. The provisioner creates its own nonce database/role/cluster on127.0.0.1 and checks both its temporary owner file and the server's database/user/cluster marker before fixture DDL. It shares the target guard with the existing A01 provider integration test. Only the four array columns of one synthetic row are writable, one cell at a time; `update_row` retains the ordinary argument shape and delegates to the existing PostgreSQL adapter. No general SQL, connection, import or file commands are registered. The normal app and release build cannot select this backend; adding a frontend query flag alone fails the native handshake.

Choose `items`, `nums`, `empty_items` or `null_items`, then use the unchanged cell dialog's **Bearbeiten**, **NULL**, **Abbrechen** and **Übernehmen** actions. The fixed readback includes grid values, exact numeric raw JSON, native array bounds/text and a statement-attempt counter. The seed includes two-dimensional negative/nonstandard bounds, precision beyond2^53, an empty array and SQL NULL. Try escaped Unicode text, `[]`, SQL NULL and a ragged value such as `[["x"],[]]`; errors retain the draft without a successful write. A committed write whose subsequent readback fails closes the saved draft and requires **Neu lesen** before further editing.

The launcher uses a dedicated random-port Vite instance with config/env-file loading disabled. The app/WebView directory is nested inside the owned cluster directory so the script's EXIT/INT/TERM/HUP cleanup also removes it on interruption. Closing the development window exits the app, closes its server and stops/removes only its own cluster. Do not start this focus-taking window while another native acceptance is active.

Scoped non-GUI checks:

```sh
CARGO_BUILD_JOBS=2 bash scripts/test-postgres-arrays-local.sh --editor-test
bun test tests/array-editor-development.test.ts tests/perf-array-editor-development.test.ts
L8DB_BROWSER_CHANNEL=chrome bun scripts/test-browser.ts array-editor-development
```

The first command is a real native provider/fixture-contract test, including rejected foreign targets, stale row IDs, busy operations, oversized input and ragged values without any attempted UPDATE. Browser tests mount the actual isolated bootstrap and existing cell dialog but mock the IPC transport; they cover keyboard/focus/cancel, precision/NULL payloads, error retention and failed-readback recovery. Neither automated suite alone substitutes for native WebView IPC and agent-desktop keyboard acceptance. On17 November2026, after the other project released desktop focus, six cases passed in the actual isolated macOS Tauri/WKWebView window: cancelled keyboard draft with unchanged row/counter; Unicode/quotes/backslashes/NULL elements with negative2D bounds; precise raw numeric JSON with zero lower bound; SQL NULL to empty array; empty array to SQL NULL; and rejected ragged/empty-subarray input with retained draft and a fresh unchanged CTID/value/statement-counter readback. The native error-state screenshot was inspected. The owned app, Vite server, WebView directory and PostgreSQL cluster all exited/cleaned successfully. Other providers/platforms, PostgreSQL versions, packaged release and broad visual/theme/clipboard acceptance remain outside this local harness.

### A16 isolated PostgreSQL routine dialog

Start the native debug fixture with Bun 1.3.10 and PostgreSQL binaries on PATH.

```sh
bash scripts/test-postgres-arrays-local.sh --routine
```

The launcher provisions its own loopback PostgreSQL cluster and a fresh incognito WebView. It uses the A01 ownership checks and verifies the database, role, cluster marker and loopback address before creating fixture objects. The debug window exposes a readiness check and two fixed routine calls. IPC accepts only the routine variant. The server connection and statements stay inside the fixture process. The launcher disables environment-file loading and closes its server and cluster when the window exits.

Open **Schnelle Routine öffnen** and invoke it with **Ausführen**. The existing grid displays one OUT row with long Unicode text, SQL NULL and a completion number. Tab to a cell's inspection button. Enter or Space opens the read-only inspector and Escape returns focus to the cell button.

Use **Langsame Routine öffnen** to test a pending call. While it runs, close and reopen the dialog or press **Alt + Umschalt + F** to switch routines in place. The dialog discards the old answer and keeps **Ausführen** disabled until the original call settles. The server-side call continues. The next fast result's completion number includes the call whose answer was discarded.

```sh
bash scripts/test-postgres-arrays-local.sh --routine-test
L8DB_BROWSER_CHANNEL=chrome bun --no-env-file scripts/test-browser.ts routine-result-development
```

The Rust test exercises genuine PostgreSQL `CALL` and the fixture's request gate. The Chrome regression renders the real dialog, result grid and inspector with controlled IPC responses so success and failure ordering can be tested independently of the server.

The macOS 27.0.1 debug window was exercised with agent-desktop and genuine WebView IPC against PostgreSQL 17.11. The long inspector showed all 57,351 UTF-8 bytes, and keyboard dismissal restored focus to the cell and then to the dialog trigger. Both close/reopen and context switch discarded a pending result. The final fast call returned completion number 5, accounting for all five server completions, including the two discarded answers.

### A11 SQL literal lists in the existing filter popovers

Run the database-free fixture with Bun 1.3.10 and an installed Chrome.

```sh
L8DB_BROWSER_CHANNEL=chrome bun --no-env-file scripts/test-browser.ts filter-list-import
```

The fixture mounts the real column filter, list input and SQL import popover. Its apply counter records each explicit filter application, and the browser tests inspect the compiled predicate and reject query IPC. The synthetic paste event uses the component's ordinary clipboard input. The SQL button and recognized paste are exercised in IN and NOT IN. The tests cover invalid and duplicate-only lists, the five-entry preview limit, confirmation, Escape, Cancel, focus restoration, and operator and column changes. Both popovers fit inside a 310 px viewport.

In the shared browser fixture, the SQL trigger showed the NEW badge with the feature release simulated as 0.19.0. After confirmation the input regained focus and the apply counter remained at zero. The separate apply button moved the counter to one and emitted the compiled PostgreSQL predicate. The browser checks use synthesized data and a local callback. Native Tauri clipboard delivery and live provider execution were outside this acceptance.

### A12 table server output

Run the isolated browser fixture with Bun 1.3.10 and installed Chrome.

```sh
L8DB_BROWSER_CHANNEL=chrome bun --no-env-file scripts/test-browser.ts table-server-output
```

The fixture mounts the real table output dialog, shared virtualized panel, query output hook and query tabs. The synthetic grid operation uses the existing output delivery function. Its IPC boundary supplies the transaction result and records clipboard writes. The fixture has its own browser profile and loopback listener.

The browser cases verify the disabled and enabled empty states, one explicit activation, message and detail rendering, and a read warning after a successful synthetic write. They switch database context while a read is pending and verify that its late output stays with the original database. Copy and clear are local to the selected database. The query tab still starts closed and exposes the connection-wide history when selected. At 380 × 420 px, the compact table dialog fits the viewport, supports keyboard scrolling and renders fewer than 100 log rows out of 2,000. Escape restores focus to the table trigger.

Native WebView and native clipboard delivery, real write/capture and provider buffers require separate acceptance. These are synthetic outputs and do not establish commit state.

### A15 exact number display

Run the isolated browser fixture with Bun 1.3.10 and installed Chrome.

```sh
L8DB_BROWSER_CHANNEL=chrome bun --no-env-file scripts/test-browser.ts number-display
```

The fixture renders the existing table and query grids, both **Weitere Aktionen > Zahlen** entries and the shared persisted setting. The runner uses a fresh browser context and its own ephemeral loopback listener. The fixture uses local synthetic rows and rejects every IPC command except the recorded clipboard write.

The cases cover original and grouped display, the 0/2/4 minimum fraction settings, integers beyond 2^53, negative high-precision decimals, NULL, text identifiers and numeric-looking query strings without type metadata. The setting applies to both grids and survives reload. In light and 365 px dark views, keyboard navigation and select/dismiss restore focus and the compact submenu fits the viewport. Copy submits the raw integer to the synthetic clipboard boundary. Editing starts with the raw value and submits exact old and new strings at the existing grid callback. Format changes send no IPC. Native WebView, the OS clipboard, native multi-window synchronization and live provider reads and writes remain separate.

### A21 PostgreSQL table paging with tied sort values

```sh
bash scripts/test-postgres-arrays-local.sh --paging-test
```

This mode uses the existing owned loopback PostgreSQL fixture and runs one scoped Rust test. It verifies the normal adapter and active-transaction reader against actual rows. The test walks four pages with duplicate and NULL sort values, checks both sort directions, and sorts by one part of a composite primary key. Quoted identifiers and a primary-key index INCLUDE column of type `json` exercise the distinction between key columns and index payload. Separate tables cover implicit ordering, invalid sort selection and the fallback without a key.

A known PostgreSQL primary key breaks ties behind the selected sort column. The adapter reads the key from its existing column lookup. Deferrable primary keys and classic inheritance parents keep the previous explicit order because their visible rows can have matching key values. OFFSET pages still read the current database or transaction snapshot. Concurrent mutations can move rows between page requests.

On macOS 27.0.1 arm64 (Apple M3, 16 GiB, PostgreSQL 17.11), eleven measured reads at offset 25,000 on 50,000 synthetic rows returned 100 rows each in 44.196 ms median and 87.070 ms p95. The test limits are 100 ms median, 250 ms p95 and 10,000 bytes of serialized rows for this fixture. The change adds no catalog round trip. The result measures local provider reads and decoding for this workload.

### A22 loaded record view

```sh
L8DB_BROWSER_CHANNEL=chrome bun --no-env-file scripts/test-browser.ts table-record
```

The isolated fixture mounts the table grid. Open **Datensatz anzeigen** from a row's context menu or press **Alt+Enter** on the focused grid selection. The dialog reads the one loaded row, including columns outside the horizontal viewport, and uses the grid's existing value previews and number/time settings. It distinguishes NULL, empty text and missing fields. Long values show a bounded preview with an ellipsis where needed. The record closes when its row is replaced or its table changes. Escape returns focus to the grid or the still-present control that opened the menu.

Chrome cases cover a 320 × 420 px dark viewport, a wide light viewport, keyless rows, exact numeric strings, timestamps, booleans, multiline text and nested values. The 1,200-field case scrolls to the last field by keyboard and repeats opening and closing the dialog. On macOS 27.0.1 arm64 (Apple M3, 16 GiB, Bun 1.3.10, Chrome 157), nine keyboard-to-first-field samples took 21.74 ms median and 37.55 ms p95 against 150 ms and 300 ms limits. At most 15 field rows were mounted at the measured positions against a limit below 45. The fixture recorded zero IPC requests, and closed dialogs unmounted their field lists. This measures the synthetic browser path. Native WebView, native assistive technology and live providers were outside the suite.

### A24 SQL file read encoding

```sh
bun --no-env-file test tests/sql-file-encoding.test.ts
L8DB_BROWSER_CHANNEL=chrome bun --no-env-file scripts/test-browser.ts sql-file-encoding
bun --no-env-file test tests/perf-sql-file-encoding.test.ts
```

Open the editor's **Weitere Werkzeuge → Datei** menu to choose **SQL-Datei mit Kodierung öffnen…** or **Datei mit Kodierung neu laden…**. Automatic reading still tries UTF-8 first and falls back to Windows-1252. Choose UTF-16 LE or BE explicitly, with or without a matching byte-order mark. A conflicting mark or invalid UTF-16 leaves the existing draft in place. Reloading a file with unsaved changes prompts for confirmation. External-change reload uses the tab's last read choice.

For a protected source, **UTF-8-Kopie speichern…**, the save shortcut and save-on-close require a new target file. A successful save rebinds the tab to the UTF-8 copy. UTF-16, Windows-1252 fallback and automatic input with zero bytes receive this protection when loaded. Older persisted tabs establish the protection on the next read. The decoder does not guess the byte order of an unmarked file.

The Bun fixture reads and writes real temporary synthetic files through a stubbed Tauri IPC boundary. It verifies the sent UTF-8 bytes and exclusive-create option, including a symlink alias targeting the original file. The browser fixture uses the real menu, encoding chooser, external-change banner, tab store and file actions, with a synthetic editor draft and mocked pickers/IPC. Native picker, native WebView and OS file grants remain separate.

The scoped decoder benchmark read 10,485,750 bytes per iteration on macOS 27.0.1 arm64, Apple M3, 16 GiB, Bun 1.3.10. Nine measured iterations after two warmups took 11.83 ms median and 12.48 ms p95 against 70/150 ms limits. The check asserts the decoded UTF-16 length bound. It measures decoding, outside native I/O or peak process memory.
