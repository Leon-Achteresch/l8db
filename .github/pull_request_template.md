## What

<!-- What does this change? One or two sentences. -->

## Why

<!-- Which problem does it solve? Link the issue if there is one: Closes #123 -->

## How tested

<!-- What did you actually run or click? -->

- [ ] `bunx biome check ./src`
- [ ] `bun run build`
- [ ] `bun run test`
- [ ] `cargo fmt --check`, `cargo check`, `cargo clippy`, `cargo test` in `src-tauri/` (if the backend changed)
- [ ] Checked manually in `bun run tauri dev`

## Checklist

- [ ] Commit subjects follow Conventional Commits (`feat:`, `fix:`, `docs:`, …) — the release changelog is generated from them
- [ ] Docs in `docs/` updated if behaviour changed
- [ ] `CHANGELOG.md` `[Unreleased]` section updated if user-facing changes ship
