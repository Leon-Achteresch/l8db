# OpenSSL RSA backend

Upstream: `russh 0.64.1`, copied from the crates.io release. Original licenses,
`Cargo.toml.orig` are retained. Upstream test/example/benchmark targets and
fixtures are omitted from these runtime-only vendored copies to avoid distributing
example private keys; their test targets are disabled. Application regression tests
generate disposable keys and exercise the production API. The root Cargo patch selects this local
copy without changing its upstream package name or version.

## Purpose

Remove every RustCrypto `rsa` dependency affected by
[RUSTSEC-2023-0071](https://rustsec.org/advisories/RUSTSEC-2023-0071.html), while keeping
RSA host keys, authentication, signatures and key import/export available.
`rsa` remains the SSH feature flag; its implementation now selects `openssl` with
`vendored` enabled. This backend requires std and uses the OpenSSL CSPRNG for key
generation, rather than the caller-supplied RNG. The application always uses std.

## Changes

- `src/keys/mod.rs`
- `src/keys/format/mod.rs`
- `src/keys/format/pkcs8.rs`
- `Cargo.toml`: replace the optional RSA crate with vendored OpenSSL; disable
  omitted upstream standalone test/example/benchmark targets.
- `README.md`: normalize three upstream trailing spaces for Git whitespace checks.

SSH-key converts SSH mpints to native key components. Secret BN values use secure
allocations and constant-time flags. Native BN remainder operations derive CRT
exponents using a secure context. EVP performs PKCS#1 signatures and verification
with the negotiated SHA-256/SHA-512 (and feature-gated legacy SHA-1). Native private
keys are checked once before use and cached in a per-key OnceLock. The cache is bounded
to one native key per SSH keypair, shares that key on clones and ends with its owner. Temporary secret byte vectors are zeroized.
Russh imports PKCS#1/PKCS#8 through OpenSSL and exports interoperable PKCS#8.
PEM exports wrap base64 at 64 columns so OpenSSL accepts RSA keys longer than 1024 bits.
No network/database fallback or audit exception is introduced.

## Verification and maintenance

Application tests: `cargo test --locked --lib warehouse_auth -- --test-threads=1 --nocapture`.
Performance: `cargo test --locked --lib rsa_security_perf -- --ignored --test-threads=1 --nocapture`
(runs separately in the performance workflow to isolate timing from parallel unit tests).
These cover PKCS#1/PKCS#8, AES/3DES encrypted PKCS#8, independent ring verification,
SSH signatures, namespaces, tampering, wrong passwords and 2048/4096-bit budgets.
`bun run test:integration` checks RSA-only OpenSSH host keys and 3072-bit client keys
in plain/encrypted OpenSSH and PKCS#1 form against real PostgreSQL, including cleanup.
See [the measured results](../../../docs/performance.md).

For an upstream update, compare the listed files against the new published source,
port only this backend adaptation, run these checks and unfiltered `cargo audit`.
Remove both forks together when upstream offers a suitable backend. Do not restore
the vulnerable dependency or an ignored advisory to simplify an upgrade.
