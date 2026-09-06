# Release Runbook

Releases are built and published by GitHub Actions when a `v*` tag is pushed.
Artifacts: macOS (DMG), Windows (MSI/NSIS), Linux (AppImage/deb) plus
`latest.json` for the in-app auto-updater.

## One-time setup: updater signing keys

Without these secrets the release still builds installers, but the
auto-updater cannot verify or install updates.

```bash
bunx tauri signer generate -w ~/.tauri/l8db.key
```

This prints the public key and writes the keypair to `~/.tauri/`.
Then:

1. Copy the public key into `src-tauri/tauri.conf.json` under
   `plugins.updater.pubkey` (replacing the placeholder) and commit it.
2. Add repository secrets (Settings → Secrets and variables → Actions):
   - `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/l8db.key`
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — the password you chose
3. Never commit `*.key` files (covered by `.gitignore`).

## Cutting a release

1. Update `CHANGELOG.md`: move entries from `[Unreleased]` into a new
   version section with today's date.
2. Bump the version in all three manifests at once:
   ```bash
   node scripts/version.mjs set 0.2.0
   ```
   This updates `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`
   and `src-tauri/tauri.conf.json`. Verify with:
   ```bash
   node scripts/version.mjs check
   ```
3. Commit, merge to `main` via pull request, wait for CI to go green.
4. Tag and push from `main`:
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
   Pre-releases use a suffix (`v0.2.0-beta.1`) and are marked as pre-release
   automatically. Tags that do not match the source version fail fast in the
   `check-version` job.
5. Watch Actions → Release. When done, verify on the GitHub release page:
   installers for all three platforms plus `latest.json` are attached.
6. Smoke-test the updater: install the previous version, start the app,
   confirm Settings → Updates offers the new version.

## Notes

- Release builds use default Cargo features. DuckDB and ODBC stay optional
  (`--features duckdb`, `--features odbc`) and report as unavailable drivers.
- Linux builds target Ubuntu 22.04 for broad glibc compatibility.
- `main` is protected by the CI workflow (typecheck, lint, tests, Rust
  fmt/check/clippy/test, version sync). Keep it green.
