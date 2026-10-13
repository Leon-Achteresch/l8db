import { expect, test } from "bun:test";
import { arch, cpus, release as osRelease, platform, totalmem } from "node:os";
import { overviewModel } from "../src/lib/versioning/overview";
import {
  DEFAULT_TICKETS,
  findTickets,
  groupChanges,
  reviewRows,
  tableChanges,
} from "../src/lib/versioning/review";
import type {
  DatabaseRelease,
  DatabaseTarget,
  RepositoryStatus,
  VersioningProject,
} from "../src/lib/versioning/types";

const OBJECTS = 5000;
const FILES = 2000;
const LINES = 20_000;
const RUNS = 20;
const COLUMNS = 1600;

const percentile = (values: number[], ratio: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * ratio))];
const measure = (run: () => void) => {
  const samples: number[] = [];
  for (let index = 0; index < RUNS; index++) {
    const started = performance.now();
    run();
    samples.push(performance.now() - started);
  }
  return { median: percentile(samples, 0.5), p95: percentile(samples, 0.95) };
};

const project: VersioningProject = {
  format: 1,
  id: "p",
  name: "Shop",
  kind: "postgres",
  objects: Array.from({ length: OBJECTS }, (_, index) => ({
    id: `o${index}`,
    path: `database/objects/app-t${index}-table-${String(index).padStart(8, "0")}.sql`,
    selection: {
      schema: "app",
      objectType: index % 5 ? "table" : "view",
      objectName: `t${index}`,
      objectOid: null,
    },
  })),
};
const files = Array.from({ length: FILES }, (_, index) => ({
  path: project.objects[index * 2].path,
  status: index % 7 ? "M" : "A",
}));
const before = Array.from(
  { length: LINES },
  (_, index) => `  column_${index} integer NOT NULL`,
).join("\n");
const changed = before.split("\n");
for (let index = 0; index < LINES; index += 100) changed[index] = `  column_${index} bigint NULL`;
const after = changed.join("\n");

test("database review of large pull requests stays responsive", () => {
  let groups = groupChanges(files, project);
  const grouping = measure(() => {
    groups = groupChanges(files, project);
  });
  let rows = reviewRows(before, after);
  const diff = measure(() => {
    rows = reviewRows(before, after);
  });
  const wide = (lines: string[]) => `TABLE app.t\nCOLUMNS\n${lines.slice(0, COLUMNS).join("\n")}`;
  let structure = tableChanges(wide(before.split("\n")), wide(changed));
  const summary = measure(() => {
    structure = tableChanges(wide(before.split("\n")), wide(changed));
  });
  const titles = Array.from(
    { length: 500 },
    (_, index) => `SHOP-${index}: Änderung an Tabelle t${index}`,
  );
  let tickets = findTickets(titles, DEFAULT_TICKETS);
  const detection = measure(() => {
    tickets = findTickets(titles, DEFAULT_TICKETS);
  });
  console.log(
    JSON.stringify({
      scenario: "versioning-review",
      objects: OBJECTS,
      files: FILES,
      diffLines: LINES,
      diffRows: rows.length,
      groupingMedianMs: Number(grouping.median.toFixed(2)),
      groupingP95Ms: Number(grouping.p95.toFixed(2)),
      diffMedianMs: Number(diff.median.toFixed(2)),
      diffP95Ms: Number(diff.p95.toFixed(2)),
      tableColumns: COLUMNS,
      structureMedianMs: Number(summary.median.toFixed(2)),
      ticketMedianMs: Number(detection.median.toFixed(2)),
      os: `${platform()} ${osRelease()}`,
      arch: arch(),
      cpu: cpus()[0]?.model,
      ramGb: Math.round(totalmem() / 2 ** 30),
      runtime: `bun ${Bun.version}`,
    }),
  );
  expect(groups.reduce((sum, group) => sum + group.entries.length, 0)).toBe(FILES);
  expect(rows.filter((row) => row.kind === "add")).toHaveLength(LINES / 100);
  expect(rows.length).toBeLessThan(LINES / 10);
  expect(structure?.[0].changed).toHaveLength(COLUMNS / 100);
  expect(tickets).toHaveLength(50);
  expect(grouping.p95).toBeLessThan(40);
  expect(diff.p95).toBeLessThan(150);
  expect(summary.p95).toBeLessThan(20);
  expect(detection.p95).toBeLessThan(20);
});

test("overview model stays fast for large fleets", () => {
  const releases: DatabaseRelease[] = Array.from({ length: 400 }, (_, index) => ({
    format: 1,
    id: `v${index}`,
    projectId: "p",
    kind: "postgres",
    parent: index ? `v${index - 1}` : null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    objects: [],
    migrations: [],
  }));
  const targets: DatabaseTarget[] = Array.from({ length: 600 }, (_, index) => ({
    id: `t${index}`,
    name: `Ziel ${index}`,
    customer: `Kunde ${index % 200}`,
    connectionId: `c${index}`,
    database: null,
    schema: "app",
    production: index % 3 === 2,
    history: [],
    release: {
      id: `v${index % 400}`,
      commit: "a".repeat(40),
      path: `database/releases/v${index % 400}.json`,
    },
  }));
  const status: RepositoryStatus = {
    repo: "/r",
    head: "a".repeat(40),
    branch: "main",
    branches: ["main"],
    files: [],
    changes: "",
    history: Array.from(
      { length: 30 },
      (_, index) => `${String(index).padStart(40, "0")}\tSHOP-${index}: Fix`,
    ).join("\n"),
  };
  let model = overviewModel(project, status, releases, targets, DEFAULT_TICKETS);
  const timing = measure(() => {
    model = overviewModel(project, status, releases, targets, DEFAULT_TICKETS);
  });
  console.log(
    JSON.stringify({
      scenario: "versioning-overview",
      objects: OBJECTS,
      releases: releases.length,
      targets: targets.length,
      medianMs: Number(timing.median.toFixed(2)),
      p95Ms: Number(timing.p95.toFixed(2)),
    }),
  );
  expect(model.customers).toBe(200);
  expect(model.commits).toHaveLength(6);
  expect(model.objects).toBe(OBJECTS);
  expect(timing.p95).toBeLessThan(80);
});
