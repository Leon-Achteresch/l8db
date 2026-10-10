import { expect, test } from "bun:test";
import { arch, cpus, release as osRelease, platform, totalmem } from "node:os";
import { buildPipeline, pipelineNextStep, releaseTracks } from "../src/lib/versioning/pipeline";
import { rollbackBases } from "../src/lib/versioning/rollback";
import type {
  DatabaseRelease,
  DatabaseTarget,
  RepositoryStatus,
  VersioningProject,
} from "../src/lib/versioning/types";

const RELEASES = 400;
const CUSTOMERS = 200;
const LINES = 50;
const RUNS = 30;

const status: RepositoryStatus = {
  repo: "/repo",
  head: "a".repeat(40),
  branch: "main",
  branches: ["main"],
  files: [],
  changes: "",
  history: "",
};
const releases: DatabaseRelease[] = [];
for (let index = 0; index < RELEASES; index++) {
  const line = index < RELEASES / 2 ? null : `kunde-${index % LINES}`;
  const previous = line
    ? (releases.findLast((entry) => entry.track === line)?.id ?? `v${RELEASES / 2 - 1}`)
    : index
      ? `v${index - 1}`
      : null;
  releases.push({
    format: 1,
    id: line ? `${line}.${index}` : `v${index}`,
    projectId: "p",
    kind: "oracle",
    parent: previous,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    objects: [],
    migrations: [],
    ...(line ? { track: line } : {}),
  });
}
const targets: DatabaseTarget[] = Array.from({ length: CUSTOMERS }, (_, customer) => {
  const track = customer % 4 === 0 ? undefined : `kunde-${customer % LINES}`;
  const base = track ? `v${RELEASES / 2 - 1}` : `v${customer % (RELEASES / 2)}`;
  return (["development", "test", "production"] as const).map((stage) => ({
    id: `${customer}-${stage}`,
    name: `${customer} ${stage}`,
    customer: `Kunde ${customer}`,
    environment: stage,
    stage,
    connectionId: `c${customer}`,
    database: null,
    schema: "APP",
    production: stage === "production",
    release: { id: base, commit: "a".repeat(40), path: `database/releases/${base}.json` },
    history: [],
    ...(track ? { track } : {}),
  }));
}).flat();
const project: VersioningProject = {
  format: 1,
  id: "p",
  name: "Shop",
  kind: "oracle",
  objects: [
    {
      id: "o",
      path: "database/objects/o.sql",
      selection: { schema: "APP", objectType: "package", objectName: "O", objectOid: null },
    },
  ],
};

const percentile = (values: number[], ratio: number) =>
  [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * ratio))];

test("pipeline view model stays fast for large customer fleets", () => {
  const tracks = releaseTracks(releases, targets);
  const samples: number[] = [];
  let cells = 0;
  for (let run = 0; run < RUNS; run++) {
    const started = performance.now();
    for (const track of ["main", "kunde-1"]) {
      const pipeline = buildPipeline(targets, releases, status, track);
      cells = pipeline.rows.reduce(
        (sum, row) =>
          sum + row.cells.development.length + row.cells.test.length + row.cells.production.length,
        0,
      );
    }
    pipelineNextStep(project, status, releases, targets);
    samples.push(performance.now() - started);
  }
  const median = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  console.log(
    JSON.stringify({
      scenario: "versioning-pipeline",
      releases: RELEASES,
      targets: targets.length,
      tracks: tracks.length,
      cells,
      medianMs: Number(median.toFixed(2)),
      p95Ms: Number(p95.toFixed(2)),
      os: `${platform()} ${osRelease()}`,
      arch: arch(),
      cpu: cpus()[0]?.model,
      ramGb: Math.round(totalmem() / 2 ** 30),
      runtime: `bun ${Bun.version}`,
    }),
  );
  expect(tracks).toHaveLength(LINES + 1);
  expect(cells).toBeLessThanOrEqual(targets.length);
  expect(median).toBeLessThan(25);
  expect(p95).toBeLessThan(60);
});

test("rollback candidates stay fast on long release histories", () => {
  const samples: number[] = [];
  let offered = 0;
  for (let run = 0; run < RUNS; run++) {
    const started = performance.now();
    offered = 0;
    for (let index = 0; index < RELEASES; index += 8)
      offered += rollbackBases(releases, releases[index]).length;
    samples.push(performance.now() - started);
  }
  const median = percentile(samples, 0.5);
  const p95 = percentile(samples, 0.95);
  console.log(
    JSON.stringify({
      scenario: "versioning-rollback-candidates",
      releases: RELEASES,
      selections: RELEASES / 8,
      offered,
      medianMs: Number(median.toFixed(2)),
      p95Ms: Number(p95.toFixed(2)),
    }),
  );
  expect(offered).toBeGreaterThan(0);
  expect(median / (RELEASES / 8)).toBeLessThan(0.5);
  expect(p95).toBeLessThan(50);
});
