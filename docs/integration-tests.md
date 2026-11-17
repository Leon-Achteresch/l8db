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
