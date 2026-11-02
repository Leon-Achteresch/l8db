# Local DuckDB Rust patch

Published crate: `duckdb 1.20000.1`, MIT licensed, from <https://github.com/duckdb/duckdb-rs>.
The published source identity is retained in `.cargo_vcs_info.json`. All crate source
files are unchanged except one match arm in `src/row.rs`: `DataType::Null` returns
`ValueRef::Null`.

Arrow 60 represents `NullArray` without a physical null bitmap. Checking
`column.is_null(row)` therefore does not handle this type. The upstream conversion
falls through to `unreachable!`, including for nested lists, maps and structs. The
panic poisons a shared connection and breaks subsequent queries.

Keep this patch until an upstream release covers both scalar and nested untyped
NULL results. Adapter regression tests cover these shapes, subsequent queries and
a bounded 1,000-row result from a million-row source. Do not edit the Cargo registry
cache or suppress the panic.
