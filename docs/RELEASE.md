# Release Runbook

Releases are built and published automatically by GitHub Actions on every push
to `main` (plus manual runs via `workflow_dispatch`). No manual tagging:
`.github/workflows/release.yml` computes the version, generates the changelog
from Conventional Commits, and publishes installers for macOS (Universal DMG),
Windows (MSI/NSIS) and Linux (deb/AppImage) plus `latest.json` for the in-app
auto-updater.

## How it works

1. **Checks** — reuses the CI workflow (`workflow_call`): version sync,
   frontend (biome, build, tests), Rust (fmt, check, clippy, tests).
2. **Prepare** — `node .github/scripts/compute-release-version.mjs` derives
   `<major>.<minor>.<patch>` from `package.json` (`major.minor` as baseline,
   `patch` = commit count since the last `major.minor` bump). The changelog is
   grouped from commit subjects (`feat:`, `fix:`, `refactor:`, `perf:`,
   `docs:`, `test:`, `build:`, `ci:`, `style:`, `chore:`).
3. **Publish** — `node .github/scripts/set-version.mjs <version>` patches the
   version transiently into `package.json`, `package-lock.json`,
   `src-tauri/Cargo.toml` and `src-tauri/tauri.conf.json` (not committed),
   then `tauri-action` builds and attaches the bundles to tag `v<version>`
   as `l8db v<version>`.

Version scheme example: with `package.json` at `0.1.0` and 42 commits since,
the release becomes `v0.1.42`. Bump `major.minor` in the source files to start
a new series (e.g. `0.2.0` → `v0.2.x`).

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
   version section with today's date (the GitHub release body itself is
   auto-generated, the CHANGELOG stays the curated record).
2. Use Conventional Commits on `main` (`feat:`, `fix:`, …) — they become the
   release notes.
3. Merge to `main` via pull request, wait for CI to go green.
4. The push to `main` triggers the Release workflow automatically.
   Watch Actions → Release. When done, verify on the GitHub release page:
   installers for all three platforms plus `latest.json` are attached.
5. Smoke-test the updater: install the previous version, start the app,
   confirm Settings → Updates offers the new version.

Local version helpers (manual bumps, pre-release checks):

```bash
node scripts/version.mjs check        # package.json, Cargo.toml, tauri.conf.json in sync?
node scripts/version.mjs set 0.2.0    # bump major.minor baseline in all manifests
```

## Distribution channels

`packaging/` holds the manifests for the OS package managers. Publishing is
deliberately manual — per release, update the templates and copy them to the
target repo. Full per-channel guide: [`packaging/README.md`](../packaging/README.md).

| Channel | Manifests | Artifact |
| --- | --- | --- |
| Homebrew (macOS) | `packaging/homebrew/l8db.rb` | `l8db_<version>_universal.dmg` |
| winget (Windows) | `packaging/winget/*.yaml` | `l8db_<version>_x64_en-US.msi` |
| AUR (Arch Linux) | `packaging/aur/PKGBUILD` | `l8db_<version>_amd64.deb` |
| Flatpak (Linux) | `packaging/flatpak/com.leon.l8db.yml` | `l8db_<version>_amd64.deb` |

Helper script (pure Node, no dependencies):

```bash
gh api repos/Leon-Achteresch/l8db/releases/latest > release.json
node scripts/update-packaging.mjs --release release.json --dry-run
node scripts/update-packaging.mjs --release release.json
```

## Notes

- Release builds use default Cargo features with the optimized
  `[profile.release]` (`opt-level=3`, thin LTO, `strip`, `panic="abort"`).
  DuckDB and ODBC stay optional (`--features duckdb`, `--features odbc`)
  and report as unavailable drivers.
- macOS builds target `universal-apple-darwin` (arm64 + x64 in one DMG);
  Windows builds x64 (MSI for winget, NSIS preferred by the updater);
  Linux builds target Ubuntu 22.04 for broad glibc compatibility.
- `main` is protected by the CI workflow (typecheck, lint, tests, Rust
  fmt/check/clippy/test, version sync). Keep it green — a red `main`
  blocks releases.
