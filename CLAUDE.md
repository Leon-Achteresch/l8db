@AGENTS.md

## Claude Code

- Performance-Tests mit gedrosselter CPU dürfen nicht auf dem MacBook laufen. Dazu gehören `bun run test:perf:constrained`, `tests/perf-throttle.test.ts` und jeder Browser-Test, der `Emulation.setCPUThrottlingRate` nutzt (z. B. `tests/perf-monitor-logs.test.ts`, `tests/perf-query-*.test.ts`). Auf macOS diese Tests überspringen, den Grund im Bericht nennen und auf `.github/workflows/performance.yml` verweisen.
