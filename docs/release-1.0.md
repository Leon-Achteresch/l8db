# Release 1.0 readiness

Status of the 1.0 audit (October 2026). Internationalisation is out of scope by decision.

## Done

- Licensing: Apache-2.0 everywhere (`LICENSE`, `NOTICE`, package manifests, Cargo, metainfo, AUR, winget). Release builds ship `third-party-licenses.txt` (`bun run licenses`, runs in `beforeBuildCommand`), shown under Settings → About → Open-Source-Lizenzen.
- Supply chain: `cargo audit` in CI, rustls updated for RUSTSEC-2026-0285.
- Extensions: official manifests accept l8db 1.x; process output is cut on a UTF-8 boundary.
- SQL Server: driver panics on `sql_variant`, `geography`, `geometry`, `hierarchyid` and CLR types become errors (`panic = "unwind"` + `catch_unwind`); table browsing converts these types server-side.
- Exact numbers: values JavaScript cannot represent exactly (bigint above 2^53, wide decimals) are sent as strings for PostgreSQL, MySQL, SQLite, ClickHouse, Oracle, DuckDB and Cassandra.
- DuckDB: dates, times, intervals, decimals, lists, structs, maps, enums and UUIDs render as readable JSON; foreign keys and constraint columns are listed; the triggers capability is off.
- Cassandra: paged reads (no full result in memory), capped row counts instead of `COUNT(*)` scans, exact varint/decimal, date/time/duration values, opt-in TLS.
- Query results carry `truncated`; the status bar only shows "auf 1000 begrenzt"/"Werte gekürzt" when rows or ODBC cells were really cut.
- SQLite/DuckDB no longer create empty files for mistyped paths (`?mode=rwc` opts in).
- TLS: libpq semantics, CA files and client certificates for PostgreSQL, MySQL/MariaDB and SQL Server, see [ssh-network.md](ssh-network.md#tls).

Verified against real servers: PostgreSQL 18 (TLS modes, client certificates, exact numerics), MariaDB 10.11 (TLS, X.509 login, plaintext fallback), Cassandra 5 (TLS modes, paging, counts), azure-sql-edge (unreadable types). SQL Server TLS success paths could not be verified on azure-sql-edge (its TLS handshake fails with native-tls); `live_tls_modes` in `mssql.rs` runs against a real SQL Server via `L8DB_E2E_MSSQL_TLS_URL`.

## Outstanding

### Connectivity and auth

- Unix sockets for PostgreSQL and MySQL; `redis+unix://`.
- Auth methods: Entra ID for SQL Server, AWS RDS IAM for PostgreSQL/MySQL, MongoDB `aws-auth`, Oracle SID, SYSDBA/SYSOPER and TCPS/wallet.
- SSH tunnel bypass guards: Oracle connect strings/TNS, ODBC `Server=`, Cassandra `nodes=`, MongoDB SRV/multi-host can reach hosts outside the tunnel.
- Query timeout above 300 s and `0` = unlimited.
- SQL Server client certificates; Cassandra TLS in the connection form (currently URL only).

### Security

- Secrets in URL query parameters (e.g. `sslpassword`, tokens) should move to the keychain, with migration.
- Rewrite `SECURITY.md`.
- Backend-enforced read-only for all families plus a `read_only_mode` capability; read-only MCP.
- Confirmations for destructive statements outside production mode, including Redis and MongoDB; more conservative `isWriteQuery`.
- Native confirmation before extensions start processes; restrict `backup_probe` tool paths.
- Password-manager extension: secrets out of argv (`BW_SESSION` env, `op`/Keeper via stdin), narrower allowed commands.
- Marketplace catalog signature verification (minisign, embedded public key) plus a signing script.
- Redact passwords in query history; CSP for extension panel iframes.

### Adapters

- SQLite-over-HTTP capability flags; ODBC "Erneut prüfen" status and identifier quoting.
- Redis cursor-based `SCAN`, Cluster and Sentinel.
- Editing tables without a primary key (`ctid`/`rowid`/all-column match with `LIMIT 1`/`TOP (1)`).
- Schema compare for MySQL, SQL Server and SQLite once verified end to end.
- Oracle: remove the debug stub and unused wrapper, replace the license-cookie auto-accept install, anonymise the test host; live-test the exact-number and NLS changes against Oracle 23.

### Open source and distribution

- `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md` (Contributor Covenant 2.1), `PRIVACY.md`.
- README: install instructions per OS, supported-database table, current project structure; version placeholder in the bug template; untrack `.omo/`.
- Rename `EXTENTIONS_README.me` → `docs/extensions.md` and `extention/` → `extensions/` (CI references included).
- Flatpak with ID `de.leon_achteresch.l8db`, updater disabled inside Flatpak, metainfo releases/OARS/screenshots; Flathub submission.
- ARM64 release builds (`ubuntu-22.04-arm`, `windows-11-arm`), optional Windows code signing.
- Full local data backup (export/import of all `l8db.*` keys, daily rolling backup of the last 7).

### Accessibility

- Grid ARIA roles and keyboard entry (F2, Shift+F10, keyboard column resize).
- Labels for icon buttons; hover-only buttons visible on `:focus-within`.
- `forced-colors`/`prefers-contrast` styles, `dir="auto"` on cells, platform-aware shortcut labels.

### Owner tasks

- Rebuild and republish the packaged extensions (`extention/*.l8db-extension`, market repo `Leon-Achteresch/l8db-extension-market`) so their embedded version ranges include 1.x, and sign `catalog.json`.
- Windows code-signing account, Flathub submission, website imprint/privacy page (needs the owner's address).
