# Development integration, 2026-11-06

Integrated `feat/ui-council-polish`, `perf/grid-recycle`, `autopilot-assets`, all eleven outstanding Dependabot branches, and the recovered VPS work into development. Feature branches retain their history through merge commits. The standalone screenshot history was merged with unrelated histories allowed. No release was triggered.

The v0.16.0 packaging patch from `fb93baaf` was cherry-picked as `ab8d0d97`; main's release merge commits were deliberately not back-merged, following AGENTS.md. Both main and automation/packaging have no remaining unique non-merge patch after integration.

Conflict resolution preserves the 24-tile bounded top-k atlas layout, the UI branch's small-schema grid and labelled navigation, the current before-filter plugin toolbar, and the UI styling together with recycled grid-column placement and accessibility roles. Existing lazy header popovers stay intact. The dependency integration exposed mixed @dnd-kit/dom 0.5.0/0.5.3 class identities; the direct DOM dependency is now aligned at ^0.5.3 with React's resolved dependencies.

## Validation

- Bun 1.3.10 frozen-lockfile installation succeeded; the deliberate DnD alignment then updated package.json and bun.lock together.
- TypeScript passed after DnD alignment.
- Biome checked the 114 changed frontend source files: zero errors, 44 hook-dependency warnings. No warning-driven broad refactoring was performed.
- `cargo check --locked` passed with the dependency updates on macOS; existing vendored tiberius deprecation warnings remain.
- 335 tests passed in 32 isolated, explicitly selected files covering table/query grids, atlas, navigation, settings, tabs, editor helpers, packaging and performance.
- VPS recovery independently passed 422 scoped tests and its connection-import performance scenarios; see the adjacent vps-recovery-2026-11-06 report.
- One final manual integration review covered conflict resolutions, recycled-cell identity, dependency compatibility and the recovered crypto cache. No additional blocking finding remained after dependency alignment.

## Performance measurements

Real platform: macOS 27.0.1, arm64, Apple M3, 16 GiB RAM, Bun 1.3.10. Pure-JavaScript and mocked DOM scenarios below are not browser rendering or database benchmarks. The collected raw reports accompany this document under development-integration-2026-11-06/.

| Scenario | Workload | Median / p95 | Retention / limit |
|---|---|---|---|
| Recycled column slots | 10,000 windows over 1,000 columns | 22.12 / 22.45 ms | 13 retained slots; <=26 slots and p95 <250 ms |
| Grid style, classic | 5,000 rows x 400 columns | 78.29 / 83.22 ms | p95 <200 ms |
| Grid style, semantic | 5,000 rows x 400 columns | 103.00 / 115.32 ms | p95 <200 ms |
| Atlas layout | 20,000 tables, 60,000 links | 0.611 / 0.621 ms | 24 tiles |
| Buffered row windows | 5,000 updates over 100,000 rows | 0.291 / 0.299 ms | 1 retained window, zero idle allocations |
| Partial column windows | 5,000 updates over 100,000 columns | 0.895 / 1.084 ms | 1 retained window, maximum 17 indices |
| Edge fade | 20,000 scroll events + 200 resizes per run | 1.175 / 1.330 ms | 1 observer/listener; detached after use; zero React renders |

All scenarios issue zero database requests. Recycled slots have no background tasks; the edge-fade test verifies listener/observer cleanup. The slot baseline before integration used column identity keys and spacers; this integration verifies stable reused slots and bounded retained state, without claiming a measured browser speedup. The new scenario is a regression baseline for subsequent changes. Existing budgets were not loosened.

Not run: full test suites, release/production builds, browser rendering, CPU/heap throttling, live databases, Windows or Linux validation of the newly integrated UI/dependency changes. Linux evidence for recovered VPS import work is recorded separately. No claims about all database families or all computers are made.
