## What

## Why

## Verification

- [ ] `bunx biome check ./src`
- [ ] `bun run build`
- [ ] `bun run test`
- [ ] `cargo fmt --check`, `cargo check`, `cargo clippy`, `cargo test` in `src-tauri/`
- [ ] Version bump via `node scripts/version.mjs set <x.y.z>` if user-facing changes ship (keep `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` in sync)
