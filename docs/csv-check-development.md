# Isolated native CSV check

Debug-only, explicitly selected desktop entry for native CSV acceptance. It
reuses the existing dialog, filesystem grant, preview, controller, runner and
`check_csv_file` parser. It cannot connect, execute SQL or import rows.

```sh
bun run tauri dev --no-watch -- --csv-check-development
```

Alternatively, start the existing Vite server (`bun run dev`) and run the already
built debug binary with the same sole argument. Build with
`CARGO_BUILD_JOBS=2 cargo build --manifest-path src-tauri/Cargo.toml --bin l8db`.
Do not run the binary without the argument for this test. Release builds reject
the argument; mixed arguments also fail closed instead of starting the normal app.

Each start creates a fresh `l8db-csv-check-*` temporary directory and an incognito
WebView with its own data directory and unique app identifier. The native branch
runs before normal CLI, logger, automation, connection, secret or service setup.
The frontend branch runs before app-storage initialization and regular bootstrap;
it requires the dedicated native context command before importing the test view.
The production frontend build removes the debug loader. Normal startup is retained.

The window shows its own sample directory. Choose `clean.csv`, `findings.csv` or
`parser-error.csv` through the real file dialog. Only files canonically inside that
directory are accepted; symlinks outside it are rejected. Before a dialog grant,
even the generated sample must be inaccessible to the native filesystem scope.
Synthetic target columns are `id` and `name`, both text and NOT NULL. The existing
check UI displays real progress, bounded findings, errors and cancellation.
Import is permanently disabled and no write/connection commands are registered.

For cancellation or file-change acceptance, create a larger CSV only inside the
displayed sample directory, choose it through the dialog, and use the existing
check/cancel actions. Any controlled modification must affect only that owned
file. No mock transport is installed by this entry. Native results and synthetic
tests must be reported separately; a clean check is never an import guarantee.

Close the isolated window normally to exit the event loop and delete its temporary
directory. Forced termination may leave that owned directory behind; remove only
the exact directory created by the test. Never clean or modify normal profiles.
The AI-workspace configuration remains unchanged and is not required for this entry.

## Local acceptance, 17 November 2026

Actual macOS 27.0.1 arm64 debug binary with the real Tauri WebView/dialog/IPC,
not the browser mock fixture: a clean CSV completed without findings; the
synthetic structure/NULL file produced 2 findings over 3 read records; the
unclosed-quote file produced an incomplete report after 1 record. A 1,048,576-row
CSV of 254,803,976 bytes was written with a 995,328-byte buffer only inside the
session directory. Native cancellation confirmed 4,318 read records and no
approval. The next run showed the real initial 0-row event; appending 20 bytes
to that owned active file produced the changed/discarded state. Import remained
disabled throughout. These are functional observations, not throughput benchmarks.

Both fresh native sessions exited normally and their directories were verified
absent afterwards, including the larger file. No normal profile or connection
was opened. The canonical-path regression covers the macOS `/var` versus
`/private/var` alias and still rejects outside files, traversal and symlinks out.
The desktop automation tool sometimes returned uncertain AXOpen delivery despite
opening the selected file; fresh state was inspected without repeating that action.
Its changed-state wait also hit a CoreGraphics timeout; a fresh full accessibility
snapshot confirmed the final changed/discarded text. No screenshot/pixel, packaged
release, Windows/Linux or other physical-hardware acceptance is established.
