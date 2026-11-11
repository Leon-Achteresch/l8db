# Update history

Settings → Über & Updates → Version wechseln loads published releases on demand. Stable shows stable releases; Canary includes both stable and Canary releases. Only `vX.Y.Z` and `vX.Y.Z-canary.N` releases with `latest.json` are listed. Drafts, unrelated asset releases and other prerelease channels are excluded. The installed version is disabled.

Each page reads at most 100 GitHub releases. Neuere/Ältere reaches the remaining history without a fixed total-history cutoff. Search inside the select covers the current page. A page containing only releases from another channel may be empty; Ältere still reaches the next page. Page order follows GitHub's release history, with semantic version ordering within each page.

Version verwenden checks that release's manifest against the exact selected version and the organization-managed channel. It opens the existing installation confirmation without downloading the installer. Downloading, signature verification, storage flushing, installation and relaunch use the existing Tauri updater. Missing platform packages fail during preparation. A confirmed manual switch disables automatic installation before flushing settings, so the next launch does not automatically undo a rollback. Automatic update checks remain enabled according to the user's setting.

Abandoning a history page aborts the native HTTP request and removes its query cache. Preparing a version that is abandoned closes the resulting native update resource. Automatic checks cannot replace an open manual confirmation, and installation remains serialized. No database requests or periodic history refreshes are introduced.

## Scoped verification

Use Bun 1.3.10:

```sh
bun test tests/update-version-selection.test.ts
bun test tests/auto-update.test.ts
bun test tests/update-relaunch-guard.test.ts
bun test tests/update-blockers-windows.test.ts
L8DB_UPDATE_HISTORY_BROWSER=1 bun test tests/update-history-browser.test.ts
cd src-tauri
cargo test --lib updates::tests -- --nocapture
```

The Chromium fixture renders the real version picker and confirmation components with the actual Tauri JavaScript update resource and a simulated native transport. It covers channel changes, both release types in Canary, older pages, installed-version disabling, confirmation before download, the download/install/relaunch sequence, failure/retry, discarded results, resource release and cancellation. It does not replace an installed application or verify an operating-system installer/signature implementation.

A live metadata smoke check read 94 GitHub releases and verified the version and nonempty platform URL/signature fields of `v0.15.0` (Stable) and `v0.18.0-canary.4`. The unauthenticated API initially returned HTTP 403 (rate limit exceeded); the authenticated GitHub CLI read succeeded. No installer package was downloaded. This verifies release metadata availability, not cryptographic signature validity.

## Initial performance baseline

Measured 2026-11-11 on macOS Darwin 27.0.0, arm64, Apple M3, 16 GiB RAM, Bun 1.3.10, Chromium 156.0.8078.4. This is a real local browser run with simulated native transport, without CPU or heap throttling. Windows, Linux, WebKit, actual GitHub latency and real platform installation are not covered by this measurement.

Workload: 10,000 releases across 100 sequential pages, opening the select every tenth page, plus an abandoned delayed request and idle observation. Measured page latency: median **76.97 ms**, p95 **297.59 ms** against a **500 ms p95** budget. Maximum rendered options: **100** (limit 100); retained history queries: **1** (limit 2); native history calls for browsing: **100**, one per page; idle history calls: **0**; database calls: **0**. Cancellation/unmount leaves **0** retained history results. DOM and cache bounds are the memory evidence; browser heap bytes are not measured. There was no previous history feature; these values establish its initial baseline.

The native scoped benchmark additionally processes 100 pages / 10,000 release metadata entries: median **0.330 ms**, p95 **0.812 ms** against a **20 ms p95** budget; each serialized page remains below **4 KiB**. All five scoped Rust tests passed. Network downloads and platform installation are separate from that CPU workload.
