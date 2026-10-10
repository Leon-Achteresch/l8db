import { describe, expect, test } from "bun:test";
import { buildPipeline, pipelineNextStep, releaseTracks } from "../src/lib/versioning/pipeline";
import type {
  DatabaseRelease,
  DatabaseTarget,
  RepositoryStatus,
  VersioningProject,
} from "../src/lib/versioning/types";

const status: RepositoryStatus = {
  repo: "/repo",
  head: "a".repeat(40),
  branch: "main",
  branches: ["main"],
  files: [],
  changes: "",
  history: "",
};
const release = (
  id: string,
  parent: string | null,
  track?: string,
  minute = 0,
): DatabaseRelease => ({
  format: 1,
  id,
  projectId: "p",
  kind: "oracle",
  parent,
  createdAt: `2026-10-01T12:${String(minute).padStart(2, "0")}:00Z`,
  objects: [],
  migrations: [],
  ...(track ? { track } : {}),
});
const target = (
  customer: string,
  stage: "development" | "test" | "production",
  version: string | null,
  track?: string,
): DatabaseTarget => ({
  id: `${customer}-${stage}`,
  name: `${customer} ${stage}`,
  customer,
  environment: stage,
  stage,
  connectionId: customer,
  database: null,
  schema: "APP",
  production: stage === "production",
  release: version
    ? { id: version, commit: "a".repeat(40), path: `database/releases/${version}.json` }
    : null,
  history: [],
  ...(track ? { track } : {}),
});
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

describe("versioning pipeline", () => {
  const releases = [
    release("v1", null),
    release("v2", "v1", undefined, 1),
    release("x-1", "v2", "kunde-x", 2),
    release("x-2", "x-1", "kunde-x", 3),
  ];
  const targets = [
    target("X", "test", "x-2", "kunde-x"),
    target("X", "production", "x-1", "kunde-x"),
    target("Y", "test", "v2"),
    target("Y", "production", "v1"),
  ];

  test("lists main first and every customer line", () => {
    expect(releaseTracks(releases, [...targets, target("Z", "test", "v1", "kunde-z")])).toEqual([
      "main",
      "kunde-x",
      "kunde-z",
    ]);
  });

  test("shows a customer change only on its own line and stage", () => {
    const line = buildPipeline(targets, releases, status, "kunde-x");
    expect(line.tip?.id).toBe("x-2");
    expect(line.committed).toBe(true);
    expect(line.rows.map((row) => row.customer)).toEqual(["X"]);
    expect(line.rows[0].cells.test[0].current).toBe(true);
    expect(line.rows[0].cells.production[0].progress.pending).toBe(1);
    expect(
      line.stages.map((stage) => [stage.stage, stage.current, stage.total, stage.pending]),
    ).toEqual([
      ["development", 0, 0, 0],
      ["test", 1, 1, 0],
      ["production", 0, 1, 1],
    ]);
    const main = buildPipeline(targets, releases, status, "main");
    expect(main.tip?.id).toBe("v2");
    expect(main.rows.map((row) => row.customer)).toEqual(["Y"]);
  });

  test("treats an uncommitted tip as draft", () => {
    const line = buildPipeline(
      targets,
      releases,
      { ...status, changes: " M database/releases/x-2.json\0" },
      "kunde-x",
    );
    expect(line.tip?.id).toBe("x-1");
    expect(line.rows[0].cells.production[0].progress.state).toBe("current");
  });

  test("points to the next open step", () => {
    expect(pipelineNextStep({ ...project, objects: [] }, status, [], [])?.area).toBe("development");
    expect(
      pipelineNextStep(
        project,
        { ...status, changes: " M database/objects/o.sql\0" },
        releases,
        targets,
      )?.area,
    ).toBe("development");
    expect(pipelineNextStep(project, status, [], targets)?.area).toBe("releases");
    expect(pipelineNextStep(project, status, releases, [])?.area).toBe("customer");
    expect(pipelineNextStep(project, status, releases, [target("N", "test", null)])?.area).toBe(
      "targets",
    );
    expect(pipelineNextStep(project, status, releases, targets)).toBeNull();
  });
});
