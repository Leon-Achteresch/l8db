# SQL Server info messages

Published crate: `tiberius 0.12.3`, MIT/Apache-2.0, from <https://github.com/prisma/tiberius>.
The published source identity is retained in `.cargo_vcs_info.json`; `Cargo.toml.orig` and
both licenses are kept. Upstream tests, examples and Docker files are omitted; their test
targets are disabled in `Cargo.toml`.

## Purpose

Upstream decodes every INFO token (`PRINT`, `RAISERROR` with severity <= 10, database
context changes) but only forwards the text to `tracing` and then drops it. l8db shows
these messages per statement in script runs and in the Server-Ausgabe panel, so they must
reach the application with number, severity, state, procedure and line.

## Changes

- `src/tds/codec/token/token_info.rs`: `TokenInfo` derives `Clone`, fields are public.
- `src/tds/context.rs`: the connection context keeps received INFO tokens, oldest first,
  at most 2000 (older ones are dropped).
- `src/tds/stream/token.rs`: every decoded INFO token is stored in the context.
- `src/client.rs`: `Client::take_info_messages()` drains the stored tokens.

The three deprecation warnings `cargo check` prints for this crate are upstream code.
- `src/lib.rs`: re-exports `TokenInfo`.

Keep this patch until an upstream release exposes INFO tokens. Regression tests in
`src/db/mssql.rs` cover the mapping, the bound and a live PRINT/RAISERROR round trip.
