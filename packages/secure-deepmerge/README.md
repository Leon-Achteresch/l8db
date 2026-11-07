# @l8db/secure-deepmerge

Private MIT-licensed fork of [deepmerge 4.3.1](https://github.com/TehShrike/deepmerge/tree/v4.3.1)
for the Shadcn development toolchain. Original MIT attribution is in `LICENSE`.
Original bundled CJS SHA-256: `2e5160f84a1141bd927264afe4d15766f1e6cf07daef182b37ff53fea121de7d`.

The original default array merge, cloning, custom merge, symbols, special objects
and TypeScript declarations are retained. Source and target keys named `__proto__`,
`constructor` or `prototype` are always rejected, including null-prototype inputs.
This closes [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4),
whose inherited-property check alone leaves target-copy and null-prototype paths open.
Trusted caller-supplied callbacks remain responsible for their own output, as in the
original API. This change deliberately prevents using the three reserved names as
configuration properties. Upstream inline comments were removed; the license is retained.

The root `deepmerge` override points to this actual modified package. A distinct
private name identifies ownership; no upstream patched version is invented.
`tests/secure-deepmerge.test.ts` verifies the actual Shadcn/registry dependency
resolution and poisoning regressions, along with API and large-input compatibility.
The package has no runtime dependencies and runs synchronously without timers,
background work, database requests or cancellation state.

Run `bun test tests/secure-deepmerge.test.ts tests/dependency-cli.test.ts` and
unfiltered `bun audit`. Remove the override when upstream publishes a verified fix.
