import { afterAll, expect, mock, test } from "bun:test";
import { arch, cpus, release as osRelease, platform, totalmem } from "node:os";
import type { SavedConnection } from "../src/lib/connections";
import type { ManagedObject, VersioningProject } from "../src/lib/versioning/types";

const OBJECTS = 5000;
const RUNS = 20;
const CAPTURE_MS = 2;

const files = new Map<string, string>();
const definitions = new Map<string, string>();
const fingerprints = new Map<string, string>();
let cacheText: string | null = null;
const failing = new Set<string>();
const counters = { captures: 0, queries: 0, reads: 0, cacheWrites: 0, active: 0, peak: 0 };

const repository = { ...(await import("../src/lib/versioning/repository")) };
const compare = { ...(await import("../src/lib/compare-definition")) };
const capture = { ...(await import("../src/lib/versioning/capture")) };
const db = { ...(await import("../src/lib/db")) };

const names = Array.from({ length: OBJECTS }, (_, index) => `t${String(index).padStart(5, "0")}`);
for (const name of names) {
  definitions.set(name, `TABLE app.${name}\nCOLUMNS\n  id bigint NOT NULL`);
  fingerprints.set(name, `fp-${name}-1`);
}

mock.module("../src/lib/db", () => ({
  ...db,
  executeQuery: async (_kind: string, _url: string, sql: string) => {
    counters.queries++;
    const after = /COLLATE "C" > '([^']*)'/.exec(sql)?.[1] ?? null;
    const relation = /c\.relkind IN \('r', 'p', 'f'\)/.test(sql);
    const rows = relation
      ? names
          .filter((name) => after === null || name > after)
          .slice(0, 1000)
          .map((name) => ({ name, fp: fingerprints.get(name) }))
      : [];
    return { rows, columns: [], truncated: false };
  },
}));
mock.module("../src/lib/versioning/repository", () => ({
  ...repository,
  readFile: async (_repo: string, path: string) => files.get(path) ?? null,
  readFiles: async (_repo: string, paths: string[]) => {
    counters.reads++;
    return Object.fromEntries(paths.map((path) => [path, files.get(path) ?? null]));
  },
  readDriftCache: async () => cacheText,
  writeDriftCache: async (_repo: string, content: string) => {
    counters.cacheWrites++;
    cacheText = content;
  },
  saveFile: async (_repo: string, path: string, content: string) => {
    files.set(path, content);
  },
}));
mock.module("../src/lib/compare-definition", () => ({
  ...compare,
  listCompareObjects: async (_connection: unknown, side: { objectType: string }) =>
    side.objectType === "table" ? names.map((name) => ({ name, oid: null })) : [],
}));
mock.module("../src/lib/versioning/capture", () => ({
  ...capture,
  captureObject: async (_connection: unknown, _database: unknown, object: ManagedObject) => {
    counters.captures++;
    if (failing.has(object.selection.objectName ?? ""))
      throw new Error(`${object.selection.objectName} fehlt`);
    counters.active++;
    counters.peak = Math.max(counters.peak, counters.active);
    await Bun.sleep(CAPTURE_MS);
    counters.active--;
    return {
      object,
      definition: definitions.get(object.selection.objectName ?? "") ?? "",
      checksum: "",
    };
  },
}));

const { DRIFT_CONCURRENCY, clearDriftMemo, driftMemoSize, recheckDrift, saveDrift, scanDrift } =
  await import("../src/lib/versioning/drift");

const objects: ManagedObject[] = names.map((name) => ({
  id: name,
  path: `database/objects/${name}.sql`,
  metadataVersion: 3,
  selection: { schema: "app", objectType: "table", objectName: name, objectOid: null },
}));
for (const object of objects)
  files.set(object.path, `${definitions.get(object.selection.objectName ?? "")}\n`);
const project: VersioningProject = { format: 1, id: "p", name: "Shop", kind: "postgres", objects };
const connection = { id: "c", kind: "postgres", connectionString: "" } as SavedConnection;
const source = {
  connectionId: "c",
  database: "shop",
  schema: "app",
  objectType: "table" as const,
  objectName: null,
  objectOid: null,
};

const { supportedCompareObjectTypes } = await import("../src/lib/compare-types");
const { fingerprintSql } = await import("../src/lib/versioning/fingerprint");
const QUERIES =
  Math.floor(OBJECTS / 1000) +
  supportedCompareObjectTypes(connection).filter((type) =>
    fingerprintSql("postgres", type, "app", null),
  ).length;

const percentile = (values: number[], ratio: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * ratio))];
const reset = () => {
  counters.captures = 0;
  counters.queries = 0;
  counters.reads = 0;
  counters.cacheWrites = 0;
  counters.peak = 0;
};

test("working copy check reads only changed objects on large schemas", async () => {
  clearDriftMemo();
  cacheText = null;
  reset();
  const coldStarted = performance.now();
  expect(await scanDrift("/r", project, connection, source)).toEqual([]);
  const coldMs = performance.now() - coldStarted;
  const cold = { ...counters };
  expect(cold.captures).toBe(OBJECTS);
  expect(cold.peak).toBeLessThanOrEqual(DRIFT_CONCURRENCY);
  expect(cold.reads).toBe(1);
  expect(cold.cacheWrites).toBe(1);

  const samples: number[] = [];
  const heapBefore = process.memoryUsage().heapUsed;
  for (let run = 0; run < RUNS; run++) {
    reset();
    const started = performance.now();
    const entries = await scanDrift("/r", project, connection, source);
    samples.push(performance.now() - started);
    expect(entries).toEqual([]);
    expect(counters.captures).toBe(0);
    expect(counters.reads).toBe(1);
    expect(counters.queries).toBe(QUERIES);
    expect(counters.cacheWrites).toBe(0);
  }
  Bun.gc(true);
  const heapGrowthMb = (process.memoryUsage().heapUsed - heapBefore) / 2 ** 20;

  for (const name of ["t00010", "t02500", "t04999"]) {
    fingerprints.set(name, `fp-${name}-2`);
    definitions.set(name, `TABLE app.${name}\nCOLUMNS\n  id bigint NOT NULL\n  note text`);
  }
  reset();
  const changed = await scanDrift("/r", project, connection, source);
  expect(changed.map((entry) => [entry.object.id, entry.status])).toEqual([
    ["t00010", "changed"],
    ["t02500", "changed"],
    ["t04999", "changed"],
  ]);
  expect(counters.captures).toBe(3);
  const projectText = JSON.stringify(project);
  files.set("database/project.json", projectText);
  await saveDrift("/r", project, projectText, changed);
  reset();
  expect(await scanDrift("/r", project, connection, source)).toEqual([]);
  expect(counters.captures).toBe(0);

  files.set("database/objects/t00042.sql", "edited in git\n");
  reset();
  const edited = await scanDrift("/r", project, connection, source);
  expect(edited.map((entry) => entry.object.id)).toEqual(["t00042"]);
  expect(counters.captures).toBe(0);
  files.set("database/objects/t00042.sql", `${definitions.get("t00042")}\n`);

  reset();
  await scanDrift("/r", project, connection, source, { full: true });
  expect(counters.captures).toBe(OBJECTS);

  const cacheBytes = cacheText?.length ?? 0;
  const memo = driftMemoSize();
  const median = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  console.log(
    JSON.stringify({
      scenario: "versioning-working-copy-check",
      objects: OBJECTS,
      captureLatencyMs: CAPTURE_MS,
      concurrency: DRIFT_CONCURRENCY,
      coldMs: Math.round(coldMs),
      coldCaptures: cold.captures,
      warmCaptures: 0,
      warmQueries: QUERIES,
      warmMedianMs: Number(median.toFixed(2)),
      warmP95Ms: Number(p95.toFixed(2)),
      sequentialBaselineMs: OBJECTS * CAPTURE_MS,
      cacheKb: Math.round(cacheBytes / 1024),
      memoEntries: memo.entries,
      memoChars: memo.chars,
      heapGrowthMb: Number(heapGrowthMb.toFixed(1)),
      os: `${platform()} ${osRelease()}`,
      arch: arch(),
      cpu: cpus()[0]?.model,
      ramGb: Math.round(totalmem() / 2 ** 30),
      runtime: `bun ${Bun.version}`,
    }),
  );
  expect(coldMs).toBeLessThan((OBJECTS * CAPTURE_MS) / 2);
  expect(median).toBeLessThan(120);
  expect(p95).toBeLessThan(250);
  expect(cacheBytes).toBeLessThan(1024 * 1024);
  expect(memo.chars).toBeLessThan(24_000_000);
  expect(heapGrowthMb).toBeLessThan(64);
}, 60_000);

test("cancelled working copy checks stop reading the database", async () => {
  clearDriftMemo();
  cacheText = null;
  reset();
  const controller = new AbortController();
  const scan = scanDrift("/r", project, connection, source, {
    full: true,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  await expect(scan).rejects.toThrow();
  const stopped = counters.captures;
  await Bun.sleep(CAPTURE_MS * 20);
  expect(counters.captures).toBe(stopped);
  expect(counters.active).toBe(0);
  expect(stopped).toBeLessThan(OBJECTS / 4);
  expect(counters.cacheWrites).toBe(0);
});

test("a failing capture stops the remaining database reads", async () => {
  clearDriftMemo();
  cacheText = null;
  reset();
  const original = definitions.get("t00020");
  definitions.delete("t00020");
  failing.add("t00020");
  await expect(scanDrift("/r", project, connection, source, { full: true })).rejects.toThrow(
    "t00020",
  );
  const stopped = counters.captures;
  await Bun.sleep(CAPTURE_MS * 20);
  failing.delete("t00020");
  definitions.set("t00020", original ?? "");
  expect(counters.captures).toBe(stopped);
  expect(stopped).toBeLessThan(40);
});

test("the commit re-check reads only the selected objects", async () => {
  reset();
  const entries = objects.slice(0, 3).map((object) => ({
    object,
    status: "changed" as const,
    repository: {},
    database: { [object.path]: `${definitions.get(object.selection.objectName ?? "")}\n` },
  }));
  expect(await recheckDrift(connection, source, entries)).toEqual([]);
  expect(counters.captures).toBe(3);
  definitions.set("t00001", "TABLE app.t00001\nCOLUMNS\n  id int");
  expect(await recheckDrift(connection, source, entries)).toEqual(["t00001"]);
});

afterAll(() => {
  mock.module("../src/lib/versioning/repository", () => repository);
  mock.module("../src/lib/compare-definition", () => compare);
  mock.module("../src/lib/versioning/capture", () => capture);
  mock.module("../src/lib/db", () => db);
});
