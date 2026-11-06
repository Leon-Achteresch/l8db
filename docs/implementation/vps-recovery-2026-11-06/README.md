# VPS recovery, 2026-11-06

`debug-semantic.test.ts.txt` preserves the previously untracked
`tests/.debug-semantic.test.ts` byte for byte as a non-production scratch artifact.
It is outside test discovery and is not an additional supported performance suite.
Its source checkout was `l8db-autopilot` at `12b1f65cf29c7d4403fc71fd69e8f19d4785f30f`.

No code or user data was discarded. Existing product changes were committed
separately before merging the current development history.

## Integration and validation

The extraction was already upstream as `48578a28f88c88a17f64bff641f01455960603b3`.
After merging, the only product diff against `45c3431d013931563642366dc3fc94fb36871cd9`
is fixed AES key/IV buffers and identity-based DBeaver key caching.
Navicat batch decryption, profile guards, cancellation and newer transfer behavior
remain intact. Conflict resolution was performed per hunk.

- Before integration: 120 scoped tests passed across nine files.
- After integration: 422 scoped tests passed across eleven files.
- Final integrated `npx tsc -p tsconfig.app.json --noEmit`: passed.
- Biome: 18 touched files checked; no errors, eight pre-existing warnings.
- Dependency installation: Bun 1.3.10, frozen lockfile, no lockfile changes.
- An initial typecheck was stopped before validating the merged source; only
  the final integrated typecheck is authoritative.

Performance uses existing `tests/perf-connection-import.test.ts`, with 2,000
imported and 2,000 existing connections, 15 measured rounds, five retained rounds.
Budgets are unchanged: median <150 ms, p95 <300 ms, retained heap <8 MiB;
counting 50 selection toggles has p95 <50 ms.

| Scenario | Upstream median / p95 ms | Integrated median / p95 ms | Integrated retained bytes |
| --- | --- | --- | --- |
| DBeaver | 52.02 / 62.78 | 64.09 / 80.10 | 1,617,137 |
| Navicat | 79.12 / 137.13 | 85.85 / 170.93 | 1,083,751 |
| Selection counting | 1.20 / 2.24 | 1.28 / 2.04 | not measured |

All scenarios pass. These noisy VM samples do not establish a speedup.
Both previews retain the expected one IPC call and 3,500 mocked endpoint requests.
No database connection or background polling is introduced by the buffer change;
cancellation/idle behavior is unchanged. The suites use mocked transport.

Platform: Linux 6.12.111+deb13-amd64, x64, QEMU Virtual CPU version 2.5+,
eight virtual cores, 16 GiB RAM, Bun 1.3.10. No native macOS/Windows, real
database, browser, constrained CPU/heap or Rust validation was performed for
this frontend-only change.

No additional subagent review was started because the implementation brief
explicitly forbids new subagents. The parent must include the final product
diff in its required `/code-review` at high before declaring the overall work
finished.
