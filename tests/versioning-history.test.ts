import { expect, test } from "bun:test";
import { historyMarks, parseReleaseCommits } from "../src/lib/versioning/history";
import type { DatabaseRelease, DatabaseTarget } from "../src/lib/versioning/types";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

const release = (id: string, parent: string | null = null): DatabaseRelease => ({
  format: 1,
  id,
  projectId: "p",
  kind: "postgres",
  parent,
  createdAt: "2026-01-01T00:00:00.000Z",
  objects: [],
  migrations: [],
});

const target = (id: string, stage: DatabaseTarget["stage"], releaseId: string, commit: string) =>
  ({
    id,
    name: id,
    customer: `Kunde ${id}`,
    stage,
    connectionId: "c",
    database: null,
    schema: "public",
    production: stage === "production",
    release: { id: releaseId, commit, path: `database/releases/${releaseId}.json` },
    history: [],
  }) as DatabaseTarget;

test("release commits keep the newest commit that added each manifest", () => {
  const text = `\0${B}\n\ndatabase/releases/v2.json\ndatabase/releases/v1.json\n\0${A}\n\ndatabase/releases/v1.json\ndatabase/objects/x.sql\n`;
  const commits = parseReleaseCommits(text);
  expect([...commits]).toEqual([
    ["v2", B],
    ["v1", B],
  ]);
  expect(parseReleaseCommits("").size).toBe(0);
});

test("history marks put releases and deployments on the release commit", () => {
  const marks = historyMarks(
    [release("v1"), release("v2", "v1")],
    [
      target("x-test", "test", "v2", C),
      target("x-prod", "production", "v1", C),
      target("y-test", "test", "v2", C),
      target("z-test", "test", "v0", C),
    ],
    new Map([
      ["v1", A],
      ["v2", B],
    ]),
  );
  expect(marks.get(A)?.releases.map((entry) => entry.id)).toEqual(["v1"]);
  expect(marks.get(A)?.deployed.production.map((entry) => entry.id)).toEqual(["x-prod"]);
  expect(marks.get(B)?.deployed.test.map((entry) => entry.id)).toEqual(["x-test", "y-test"]);
  expect(marks.get(C)?.deployed.test.map((entry) => entry.id)).toEqual(["z-test"]);
  expect(marks.get(C)?.releases).toEqual([]);
});
