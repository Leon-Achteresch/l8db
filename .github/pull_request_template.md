## What

Describe the problem and the resulting behavior in one or two sentences.

Use a Conventional Commit title, such as `fix(query): preserve editor selection` or
`feat(storage): add bucket search`. Labels are derived from the title and changed files.
See [the automation rules](.github/METADATA.md).

## Why

Explain why this change is needed. Link a related issue with `Closes #123` when appropriate.

## How tested

Describe the checks you ran and any manual verification. Check only the items you completed.

- [ ] `bunx biome check ./src`
- [ ] `bun run build`
- [ ] `bun run test`
- [ ] `cargo fmt --check`, `cargo check`, `cargo clippy`, `cargo test` in `src-tauri/` (if the backend changed)
- [ ] Checked manually in `bun run tauri dev`

## Checklist

- [ ] Commit subjects follow Conventional Commits (`feat:`, `fix:`, `docs:`, …) — the release changelog is generated from them
- [ ] Docs in `docs/` updated if behaviour changed
- [ ] New user-facing features registered in `src/lib/new-features.ts` and connected to their UI
- [ ] Breaking changes and migration steps described, if applicable

## Screenshots

Include before/after screenshots or a recording for UI changes, if applicable.
