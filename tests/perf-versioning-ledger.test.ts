import { expect, test } from "bun:test";
import { arch, cpus, release as osRelease, platform, totalmem } from "node:os";
import { classifyBaseline, lineStatus, planChanges } from "../src/lib/versioning/change-plan";
import { parseChangeLedger } from "../src/lib/versioning/ledger";
import type { DatabaseRelease, ObjectSnapshot } from "../src/lib/versioning/types";

const TARGETS = 200;
const CHANGES = 2000;
const OBJECTS = 5000;
const RELEASES = 100;
const PER_RELEASE = CHANGES / RELEASES;

const hash = (seed: string) => seed.padStart(64, "0").slice(-64);
const objects: ObjectSnapshot[] = Array.from({ length: OBJECTS }, (_, index) => ({
  object: {
    id: `o${index}`,
    path: `database/objects/o${index}.sql`,
    selection: { schema: "APP", objectType: "table", objectName: `T${index}`, objectOid: null },
  },
  definition: `T${index}`,
  checksum: hash(`a${index}`),
}));
const releases: DatabaseRelease[] = [];
let current = objects;
for (let index = 0; index < RELEASES; index++) {
  const next = [...current];
  const migrations = Array.from({ length: PER_RELEASE }, (_, change) => {
    const touched = (index * PER_RELEASE + change) % OBJECTS;
    const before = next[touched].checksum;
    next[touched] = { ...next[touched], checksum: hash(`r${index}c${change}`) };
    return {
      id: `m${change}`,
      title: `Änderung ${change}`,
      sql: `ALTER TABLE APP.T${touched} ADD C${index} NUMBER`,
      checksum: hash(`s${index}${change}`),
      touches: [`o${touched}`],
      before: { [`o${touched}`]: before },
      ...(change === 0 && index ? { requires: [`v${index - 1}/m1`] } : {}),
    };
  });
  releases.push({
    format: 2,
    id: `v${index}`,
    projectId: "p",
    kind: "oracle",
    parents: index ? [`v${index - 1}`] : [],
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    objects: next,
    migrations,
  });
  current = next;
}
releases.push({
  ...releases[50],
  id: "v50.1",
  parents: ["v50"],
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 50, 30)).toISOString(),
  migrations: [{ ...releases[50].migrations[0], id: "hotfix", touches: [], before: {} }],
});
releases[51] = { ...releases[51], parents: ["v50", "v50.1"] };
const map = new Map(releases.map((release) => [release.id, release]));
const ledgerRows = Array.from({ length: TARGETS }, (_, target) => {
  const reached = (target * 7) % RELEASES;
  const rows: Record<string, unknown>[] = [];
  for (let index = 0; index <= reached; index++)
    for (const migration of releases[index].migrations)
      rows.push({
        T: "c",
        ID: `v${index}/${migration.id}`,
        H: migration.checksum,
        K: "versioned",
        S: "rollout",
        R: `v${index}`,
      });
  if (target % 5 === 0)
    rows.push({
      T: "c",
      ID: "v50.1/hotfix",
      H: releases[50].migrations[0].checksum,
      K: "versioned",
      S: "rollout",
      R: "v50.1",
    });
  return { reached, rows };
});

test("ledger planning stays bounded for 200 targets with 2,000 changes and 5,000 objects", () => {
  Bun.gc(true);
  const heapBefore = process.memoryUsage().heapUsed;
  const times: number[] = [];
  let queries = 0;
  let planned = 0;
  let maxTouched = 0;
  for (let round = 0; round < 3; round++)
    for (const [target, ledger] of ledgerRows.entries()) {
      const start = performance.now();
      queries++;
      const applied = parseChangeLedger(ledger.rows).changes;
      const plan = planChanges(map, `v${RELEASES - 1}`, applied, `v${ledger.reached}`);
      const line = lineStatus(map, "main", null, `v${ledger.reached}`);
      times.push(performance.now() - start);
      planned += plan.open.length;
      maxTouched = Math.max(maxTouched, plan.touched.size);
      if (round === 0 && target === 0) {
        expect(plan.open.length).toBe(CHANGES - PER_RELEASE);
        expect(line.pending).toBe(RELEASES);
      }
      if (round === 0 && ledger.reached === RELEASES - 1)
        expect(plan.steps.length).toBe(target % 5 === 0 ? 0 : 2);
    }
  Bun.gc(true);
  const retainedMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  console.log(
    JSON.stringify({
      scenario: "versioning-ledger-planning",
      targets: TARGETS,
      changes: CHANGES,
      objects: OBJECTS,
      releases: releases.length,
      plans: times.length,
      openChanges: planned / 3,
      maxTouched,
      ledgerQueriesPerTarget: queries / times.length,
      medianMs: Number(median.toFixed(2)),
      p95Ms: Number(p95.toFixed(2)),
      retainedMb: Number(retainedMb.toFixed(1)),
      os: `${platform()} ${osRelease()}`,
      arch: arch(),
      cpu: cpus()[0]?.model,
      ramGb: Math.round(totalmem() / 1024 ** 3),
      runtime: `bun ${Bun.version}`,
    }),
  );
  expect(queries / times.length).toBe(1);
  expect(maxTouched).toBeLessThanOrEqual(CHANGES + 1);
  expect(median).toBeLessThan(15);
  expect(p95).toBeLessThan(40);
  expect(retainedMb).toBeLessThan(64);
});

test("legacy format 1 histories derive touched objects once per release", () => {
  const legacy: DatabaseRelease[] = releases.slice(0, RELEASES).map((release, index) => ({
    format: 1,
    id: release.id,
    projectId: "p",
    kind: "oracle",
    parent: index ? `v${index - 1}` : null,
    createdAt: release.createdAt,
    objects: release.objects,
    migrations: release.migrations.map(({ id, title, sql, checksum }) => ({
      id,
      title,
      sql,
      checksum,
    })),
  }));
  const legacyMap = new Map(legacy.map((release) => [release.id, release]));
  const first = performance.now();
  const initial = planChanges(legacyMap, `v${RELEASES - 1}`, new Map(), "v0");
  const firstMs = performance.now() - first;
  const times: number[] = [];
  for (const ledger of ledgerRows) {
    const start = performance.now();
    planChanges(
      legacyMap,
      `v${RELEASES - 1}`,
      parseChangeLedger(ledger.rows).changes,
      `v${ledger.reached}`,
    );
    times.push(performance.now() - start);
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  console.log(
    JSON.stringify({
      scenario: "versioning-ledger-legacy-touches",
      targets: TARGETS,
      changes: CHANGES,
      objects: OBJECTS,
      firstMs: Number(firstMs.toFixed(1)),
      medianMs: Number(median.toFixed(2)),
      p95Ms: Number(p95.toFixed(2)),
    }),
  );
  expect(initial.open).toHaveLength(CHANGES);
  expect(
    initial.open.every(
      (change) => change.touches.length === (change.release === "v0" ? OBJECTS : PER_RELEASE),
    ),
  ).toBe(true);
  expect(firstMs).toBeLessThan(500);
  expect(median).toBeLessThan(15);
  expect(p95).toBeLessThan(40);
});

test("baseline classification of a legacy customer stays bounded for 5,000 objects", () => {
  const reached = releases[60].objects;
  const actual = new Map(
    reached.map((entry, index) => [
      entry.object.id,
      index % 500 === 0 ? hash(`x${index}`) : entry.checksum,
    ]),
  );
  Bun.gc(true);
  const heapBefore = process.memoryUsage().heapUsed;
  const times: number[] = [];
  let result = classifyBaseline(map, `v${RELEASES - 1}`, actual);
  for (let round = 0; round < 20; round++) {
    const start = performance.now();
    result = classifyBaseline(map, `v${RELEASES - 1}`, actual);
    times.push(performance.now() - start);
  }
  Bun.gc(true);
  const retainedMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const counts = { done: 0, open: 0, decision: 0 };
  for (const entry of result.changes) counts[entry.status]++;
  console.log(
    JSON.stringify({
      scenario: "versioning-baseline-classification",
      changes: result.changes.length,
      objects: OBJECTS,
      ...counts,
      variances: result.variances.length,
      medianMs: Number(median.toFixed(2)),
      p95Ms: Number(p95.toFixed(2)),
      retainedMb: Number(retainedMb.toFixed(1)),
    }),
  );
  expect(result.changes.length).toBe(CHANGES + 1);
  expect(counts.open).toBeGreaterThan(0);
  expect(result.variances.length).toBeGreaterThan(0);
  expect(median).toBeLessThan(100);
  expect(p95).toBeLessThan(200);
  expect(retainedMb).toBeLessThan(64);
});
