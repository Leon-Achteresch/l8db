# VPS-Relay: scoped performance evidence

2026-11-04, real MacBook run: macOS / Darwin arm64, Apple M3, 16 GiB RAM, Bun 1.3.10. No CPU/heap simulation. Storage measurements use the local filesystem and may include OS write caching; they are not durability or VPS disk-latency claims. GitHub is mocked in local tests; no database is involved.

Workload: eight concurrent complete reports, each with a 2,900,000-byte synthetic PNG buffer, JSON body below 4 MB. Each report signs a GitHub App JWT, makes exactly three mocked GitHub calls and writes one image. This initial decoder comparison predates the upload-deadline fix and used Bun with eight concurrent reports. The final self-hosted runtime uses Node and caps concurrency at four; its measurements follow below.

| Decoder | Median | p95 | Observed RSS increase | GitHub calls |
| --- | ---: | ---: | ---: | ---: |
| Existing `Uint8Array.from(atob(...), mapper)` | 201.83 ms | 203.03 ms | 425,951,232 bytes | 24 |
| Direct copy into one typed array | 56.38 ms | 58.49 ms | 96,747,520 bytes | 24 |

Budget set before optimization: p95 < 3,000 ms and observed RSS increase < 128 MiB. The original decoder failed the memory budget. The budget was not increased. RSS is sampled at mocked GitHub calls, not a continuous peak measurement; the deployed container additionally has a hard 256 MiB memory limit.

Separate bounded-state workload: 100,000 distinct client identities, at most 4096 rate-limit buckets; overflow denied. Median 0.000084 ms, p95 0.00025 ms, post-GC JSC heap increase 1,150,680 bytes (limit 32 MiB). Expired entries are reclaimed on requests, no periodic timer. Eight parallel raw storage writes total 24 MB in 3.04 ms (budget < 3 s), then quota rejection. Idle stats stay unchanged; cancellation releases the active-request slot. Limits remain 512 MiB and 4096 stored images.

Command: `bun test tests/issue-relay.test.ts tests/issue-relay-self-hosted.test.ts` using Bun 1.3.10. Functional cases cover persistence, path traversal, storage limits, expiry, spoofed IP headers, concurrency, cancellation and routing.

Missing coverage: Windows, other CPUs, continuous peak-RSS profiling, constrained CPU/heap simulation, real GitHub throughput and production network latency. A later synthetic live smoke test validates the deployed GitHub permissions, TLS, public image retrieval and rate limiting separately; it is not a load test.

## Final Node runtime and approved fixes

Bun 1.3.10 crashed on the VPS CPU, which exposes no AVX/SSE4. Node.js 24 starts and runs the scoped native tests there. The VPS entrypoint uses Node; this does not change the application build toolchain. The worker decoder still has a separate Bun regression test (eight reports, four per batch): p95 38.48 ms, observed RSS increase 76,922,880 bytes.

The upload stream now has a fixed 15 s total deadline and checks actual bytes, not just Content-Length. Failed writes use `.pending` files; successful writes are atomically renamed. Failed cleanup retains its full quota reservation and is retried before another upload. Tests include a continuously dripping real TCP connection, a real disconnect, oversized streamed bytes and injected partial-write/cleanup failures. The single read-only review found these two P2 issues; both fixes were explicitly approved. No second review was run.

MacBook, Node v24.21.0, same physical platform as above: eight complete 2.9 MB synthetic reports at four-way concurrency, median 41.30 ms, p95 44.54 ms, observed RSS increase 93,913,088 bytes; 24 mocked GitHub requests, zero active handlers afterwards. All four native Node tests passed.

Real VPS: Linux 6.8.0-106-generic, x86_64, four vCPUs reported as Common KVM processor, about 7 GiB physical guest RAM, Node v24.22.2 Alpine. Test container used the production limits of 256 MiB and 0.5 CPU; this is a real container run, not simulated macOS hardware. 100,000 identities remained at 4096 entries, median 0.000275 ms and p95 0.000941 ms. Eight complete reports (four at a time) had median 875.64 ms, p95 985.70 ms, observed RSS increase 37,027,840 bytes, 24 mocked GitHub calls and no remaining active handlers or idle writes. All four native Node tests passed. The pre-existing p95 < 3 s and RSS delta < 128 MiB budgets were retained; concurrency was reduced instead of raising the budgets.

Native command: `node --test services/issue-relay/test/self-hosted.test.js`. On the VPS this ran inside the built image with `--network none --memory 256m --cpus 0.5`; no real GitHub API requests were made by these performance tests. RSS samples remain observations at API call boundaries, not a continuous peak profiler. Network correctness is checked separately by the live smoke test.
