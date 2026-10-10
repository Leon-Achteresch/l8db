import { afterAll, describe, expect, mock, test } from "bun:test";
import type { SavedConnection } from "../src/lib/connections";
import type { DatabaseTarget, VersioningProject } from "../src/lib/versioning/types";

const started: { url: string; database: string; label?: string }[] = [];
let failure: string | null = null;
const db = { ...(await import("../src/lib/db")) };
const jobs = { ...(await import("../src/lib/branching/jobs")) };
const store = { ...(await import("../src/lib/schema-compare/store")) };
afterAll(() => {
  mock.module("../src/lib/db", () => db);
  mock.module("../src/lib/branching/jobs", () => jobs);
  mock.module("../src/lib/schema-compare/store", () => store);
});
mock.module("../src/lib/db", () => ({
  ...db,
  branchingSnapshot: async (url: string, request: { database: string; label?: string }) => {
    started.push({ url, database: request.database, label: request.label });
    return `job-${started.length}`;
  },
}));
mock.module("../src/lib/branching/jobs", () => ({
  ...jobs,
  runBranchingJob: async (start: () => Promise<string>) => {
    const id = await start();
    if (failure) throw new Error(failure);
    return { id, result: { snapshot: `snap-${id}` } };
  },
}));
mock.module("../src/lib/schema-compare/store", () => ({
  ...store,
  prepareConnection: async (id: string) => connections.find((entry) => entry.id === id),
}));

const { snapshotBeforeRollout, snapshotDatabase, snapshotTargets } = await import(
  "../src/lib/versioning/rollout-snapshot"
);

const connections = [
  { id: "a", name: "A", kind: "postgres", connectionString: "postgresql://u@db-a:5432/shop" },
  { id: "b", name: "B", kind: "postgres", connectionString: "postgresql://u@db-b:5432/" },
  {
    id: "c",
    name: "C",
    kind: "postgres",
    connectionString: "postgresql://admin@DB-A/?dbname=shop",
  },
] as SavedConnection[];
const project = {
  format: 1,
  id: "p",
  name: "Shop",
  kind: "postgres",
  objects: [],
} as VersioningProject;
const target = (
  id: string,
  connectionId: string,
  production: boolean,
  database: string | null = null,
  schema = "public",
): DatabaseTarget => ({
  id,
  name: id,
  connectionId,
  database,
  schema,
  production,
  ...(production ? {} : { stage: "test" as const }),
  release: null,
  history: [],
});

describe("snapshot before production rollout", () => {
  test("covers only PostgreSQL production targets", () => {
    const targets = [target("prod", "a", true), target("test", "a", false)];
    expect(snapshotTargets(project, targets).map((entry) => entry.id)).toEqual(["prod"]);
    expect(snapshotTargets({ ...project, kind: "oracle" }, targets)).toEqual([]);
  });

  test("uses the target database or the connection default", () => {
    expect(snapshotDatabase(target("x", "a", true, "billing"), connections[0])).toBe("billing");
    expect(snapshotDatabase(target("x", "a", true), connections[0])).toBe("shop");
    expect(() => snapshotDatabase(target("x", "b", true), connections[1])).toThrow("Datenbankname");
    expect(snapshotDatabase(target("x", "c", true), connections[2])).toBe("shop");
  });

  test("creates one snapshot per production database and skips test systems", async () => {
    started.length = 0;
    failure = null;
    const result = await snapshotBeforeRollout(
      project,
      [
        target("nord", "a", true, null, "nord"),
        target("sued", "a", true, null, "sued"),
        target("ost", "c", true, null, "ost"),
        target("test", "a", false),
        target("west", "b", true, "west"),
      ],
      connections,
      "x-2",
    );
    expect(started.map((entry) => entry.database)).toEqual(["shop", "west"]);
    expect(started.every((entry) => entry.label === "Vor Release x-2")).toBe(true);
    expect(result.map((entry) => entry.snapshot)).toEqual(["snap-job-1", "snap-job-2"]);
  });

  test("stops before the rollout when a snapshot fails", async () => {
    started.length = 0;
    failure = "pg_dump fehlt";
    await expect(
      snapshotBeforeRollout(project, [target("prod", "a", true)], connections, "x-2"),
    ).rejects.toThrow("Rollout nicht gestartet. pg_dump fehlt");
  });
});
