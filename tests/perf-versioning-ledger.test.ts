import { expect, test } from "bun:test";
import { arch, cpus, release as osRelease, platform, totalmem } from "node:os";
import {
  aheadObjects,
  classifyBaseline,
  lineStatus,
  planChanges,
  releaseClosure,
} from "../src/lib/versioning/change-plan";
import { codeStatus } from "../src/lib/versioning/code-drift";
import { parseChangeLedger } from "../src/lib/versioning/ledger";
import type {
  DatabaseRelease,
  ObjectSnapshot,
  StandaloneChange,
} from "../src/lib/versioning/types";

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

test("code drift report classifies 200 targets with 500 code objects each", () => {
  const code: ObjectSnapshot[] = Array.from({ length: 500 }, (_, index) => ({
    object: {
      id: `p${index}`,
      path: `database/objects/p${index}.pks`,
      selection: { schema: "APP", objectType: "package", objectName: `P${index}`, objectOid: null },
    },
    definition: `P${index}`,
    checksum: hash(`p${index}`),
  }));
  const fleet = Array.from({ length: TARGETS }, (_, target) => ({
    target: {
      id: `t${target}`,
      name: `Kunde ${target}`,
      connectionId: "c",
      database: null,
      schema: `S${target}`,
      production: false,
      release: null,
      history: [],
    },
    actual: new Map(
      code.map((entry, index) => [
        entry.object.id,
        index === target % 500 ? hash(`drift${target}`) : entry.checksum,
      ]),
    ),
    applied: new Map(
      code.map((entry) => [
        entry.object.id,
        { id: entry.object.id, hash: entry.checksum, change: null },
      ]),
    ),
  }));
  const times: number[] = [];
  let drift = 0;
  for (const entry of fleet) {
    const start = performance.now();
    const rows = codeStatus(entry.target, code, entry.actual, entry.applied, []);
    times.push(performance.now() - start);
    drift += rows.filter((row) => row.state === "drift").length;
  }
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  console.log(
    JSON.stringify({
      scenario: "versioning-code-drift-report",
      targets: TARGETS,
      codeObjects: code.length,
      ledgerQueriesPerTarget: 1,
      drift,
      medianMs: Number(median.toFixed(3)),
      p95Ms: Number(p95.toFixed(3)),
    }),
  );
  expect(drift).toBe(TARGETS);
  expect(median).toBeLessThan(5);
  expect(p95).toBeLessThan(20);
});

test("standalone changes distributed ahead of releases keep planning bounded", () => {
  const STANDALONE = 500;
  const standalone = new Map<string, StandaloneChange>(
    Array.from({ length: STANDALONE }, (_, index) => [
      `s${index}`,
      {
        format: 1,
        id: `s${index}`,
        kind: "versioned",
        title: `Einzeländerung ${index}`,
        checksum: hash(`x${index}`),
        sql: `CREATE INDEX I${index} ON APP.T${index} (C)`,
        touches: [`o${index}`, `o${(index * 7) % OBJECTS}`],
        before: {},
        requires: [],
        data: false,
        preconditions: [],
        postconditions: [],
      },
    ]),
  );
  const targets = ledgerRows.map((ledger, target) => {
    const applied = parseChangeLedger(ledger.rows).changes;
    for (let index = 0; index < (target % 10) * 50; index++)
      applied.set(`s${index}`, {
        id: `s${index}`,
        checksum: hash(`x${index}`),
        kind: "versioned",
        source: "rollout",
        release: null,
      });
    return { reached: ledger.reached, applied };
  });
  Bun.gc(true);
  const heapBefore = process.memoryUsage().heapUsed;
  const times: number[] = [];
  let maxAhead = 0;
  for (let round = 0; round < 3; round++)
    for (const { reached, applied } of targets) {
      const start = performance.now();
      const plan = planChanges(map, `v${RELEASES - 1}`, applied, `v${reached}`, standalone);
      const ahead = aheadObjects(plan, applied, standalone);
      const single = releaseClosure(map, `v${reached}`, standalone);
      times.push(performance.now() - start);
      maxAhead = Math.max(maxAhead, ahead.length);
      expect(single.releases.length).toBeGreaterThan(0);
    }
  Bun.gc(true);
  const retainedMb = (process.memoryUsage().heapUsed - heapBefore) / 1024 / 1024;
  times.sort((a, b) => a - b);
  const median = times[Math.floor(times.length / 2)];
  const p95 = times[Math.floor(times.length * 0.95)];
  console.log(
    JSON.stringify({
      scenario: "versioning-standalone-ahead",
      targets: TARGETS,
      standalone: STANDALONE,
      changes: CHANGES,
      objects: OBJECTS,
      plans: times.length,
      maxAhead,
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
  expect(maxAhead).toBeLessThanOrEqual(450 * 2);
  expect(median).toBeLessThan(20);
  expect(p95).toBeLessThan(50);
  expect(retainedMb).toBeLessThan(64);
});
