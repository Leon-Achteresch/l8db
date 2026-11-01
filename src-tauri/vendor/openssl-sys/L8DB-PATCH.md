# Current vendored OpenSSL source

Upstream `openssl-sys 0.9.117`, copied from crates.io with its original license,
source and `Cargo.toml.orig`. The sole patch is the `openssl-src` build dependency:
`300.2.0` becomes `400.0.2`, selecting checksum-verified `400.0.2+4.0.3` in Cargo.lock.
The existing Rust bindings and build script already support OpenSSL 4 (`ossl400`).
No C source, FFI implementation or cryptographic algorithm is locally modified.

The default 300.x dependency currently tops out at OpenSSL 3.6.3, which predates
[the September 2026 security fixes](https://openssl-library.org/news/vulnerabilities/).
Using only cargo-audit would miss this native-source gap. OpenSSL 4.0.3 includes
those fixes and is available as an official openssl-src crate. It remains statically
built; Windows uses Strawberry Perl selected by the shared toolchain action.

Validate with unfiltered cargo audit, native compilation, warehouse_auth/rsa_security
and SSH integration tests. The license generator includes the bundled OpenSSL
license separately from the Rust wrapper. See the measured results in
[performance.md](../../../docs/performance.md). Remove this manifest-only fork when
openssl-sys selects a current source release upstream. Keep supported OpenSSL major
versions and the native security release floor in view during updates.
