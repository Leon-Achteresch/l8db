# Integration tests

Run `bun run test:integration` with Docker, Docker Compose, Rust and OpenSSH client tools installed. The script creates an isolated Compose project, starts PostgreSQL 18 and OpenSSH with health checks, uses random localhost ports, generates a temporary client key and known_hosts file, runs the selected Rust tests serially and removes containers, volumes and key files on exit. Failed runs print service logs. No user database is used.

The mandatory suite covers table transactions, CSV import rollback, confirmed PostgreSQL cancellation, password/key SSH authentication, rejected authentication and unknown host keys, and CSV cursor export boundaries/cancellation. A missing service or missing required key fails the run. Other ignored tests need their own fixtures and are deliberately excluded.

CI invokes the same script. For repeatability, run it twice; each invocation provisions fresh services. Run `L8DB_LAB_TEST_UNREACHABLE=1 bun run test:integration` to verify the failure path: the required PostgreSQL URL is replaced with an unreachable localhost port. The suite must fail and remove all lab resources. This negative check was verified locally.

Run `bun run build && bun run test:browser` for the mandatory existing browser regressions. The runner starts and closes its own Vite fixture server, supplies all required test switches and runs table editing, table state (Chromium/WebKit), query workspace, QoL and comparison tests. Diagnostics are saved under `test-artifacts/browser`; CI uploads them and existing screenshots. The production CSP/extension suite remains separate.
