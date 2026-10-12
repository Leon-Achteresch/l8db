import { afterAll, describe, expect, mock, test } from "bun:test";

const files = new Map<string, string>();
const committed = new Map<string, string>();
const writes: string[] = [];
const db = { ...(await import("../src/lib/db")) };
afterAll(() => mock.module("../src/lib/db", () => db));
mock.module("../src/lib/db", () => ({
  ...db,
  versioningRepository: async (request: {
    action: string;
    path: string;
    content?: string;
    expected?: string | null;
    revision?: string;
  }) => {
    if (request.action === "read")
      return (request.revision ? committed : files).get(request.path) ?? null;
    if ((files.get(request.path) ?? null) !== request.expected)
      throw new Error(`Concurrent change ${request.path}`);
    writes.push(`${request.action}:${request.path}`);
    if (request.action === "write") files.set(request.path, request.content ?? "");
    if (request.action === "delete") files.delete(request.path);
    return null;
  },
}));

const { encode } = await import("../src/lib/versioning/repository");
const { restoreReleaseFiles, rollbackBases } = await import("../src/lib/versioning/rollback");
const { checksum } = await import("../src/lib/versioning/model");

import type {
  DatabaseRelease,
  ManagedObject,
  ObjectSnapshot,
  VersioningProject,
} from "../src/lib/versioning/types";

const pkg: ManagedObject = {
  id: "pkg",
  path: "database/objects/pkg.pks",
  bodyPath: "database/objects/pkg.pkb",
  selection: { schema: "APP", objectType: "package", objectName: "ORDER_SERVICE", objectOid: null },
};
const extra: ManagedObject = {
  id: "extra",
  path: "database/objects/extra.sql",
  selection: { schema: "APP", objectType: "view", objectName: "EXTRA", objectOid: null },
};
const snapshot = async (object: ManagedObject, definition: string): Promise<ObjectSnapshot> => ({
  object,
  definition,
  checksum: await checksum(definition),
});
const release = (
  id: string,
  parent: string | null,
  objects: ObjectSnapshot[] = [],
  track?: string,
): DatabaseRelease => ({
  format: 1,
  id,
  projectId: "p",
  kind: "oracle",
  parent,
  createdAt: "2026-10-01T12:00:00Z",
  objects,
  migrations: [],
  ...(track ? { track } : {}),
});

describe("release rollback", () => {
  test("offers only tips of the same line above the chosen release", () => {
    const releases = [
      release("v1", null),
      release("v2", "v1"),
      release("v3", "v2"),
      release("x-1", "v2", [], "kunde-x"),
      release("x-2", "x-1", [], "kunde-x"),
    ];
    const byId = (id: string) => releases.find((entry) => entry.id === id) as DatabaseRelease;
    expect(rollbackBases(releases, byId("v1")).map((tip) => tip.id)).toEqual(["v3"]);
    expect(rollbackBases(releases, byId("v2")).map((tip) => tip.id)).toEqual(["v3", "x-2"]);
    expect(rollbackBases(releases, byId("x-1")).map((tip) => tip.id)).toEqual(["x-2"]);
    expect(rollbackBases(releases, byId("x-2"))).toEqual([]);
    expect(rollbackBases(releases, byId("v3"))).toEqual([]);
  });

  test("restores package spec and body, removes newer objects and rewrites the project", async () => {
    const project: VersioningProject = {
      format: 1,
      id: "p",
      name: "Shop",
      kind: "oracle",
      objects: [pkg, extra],
    };
    const projectText = encode(project);
    files.set("database/project.json", projectText);
    files.set(pkg.path, "PACKAGE ORDER_SERVICE AS v2 END;\n");
    files.set(pkg.bodyPath as string, "BODY v2\n");
    files.set(extra.path, "CREATE VIEW extra AS SELECT 1 FROM dual\n");
    const old = release(
      "x-1",
      "v2",
      [
        await snapshot(
          pkg,
          'PACKAGE SPEC "APP".ORDER_SERVICE\n\nPACKAGE ORDER_SERVICE AS v1 END;\n\nPACKAGE BODY "APP".ORDER_SERVICE\n\nBODY v1',
        ),
      ],
      "kunde-x",
    );
    for (const [path, content] of files) committed.set(path, content);
    files.set(pkg.path, "PACKAGE ORDER_SERVICE AS local END;\n");
    await expect(
      restoreReleaseFiles("/repo", project, projectText, old, "a".repeat(40)),
    ).rejects.toThrow("lokale Änderungen");
    expect(writes).toEqual([]);
    files.set(pkg.path, committed.get(pkg.path) as string);
    const result = await restoreReleaseFiles("/repo", project, projectText, old, "a".repeat(40));
    expect(files.get(pkg.path)).toBe("PACKAGE ORDER_SERVICE AS v1 END;\n");
    expect(files.get(pkg.bodyPath as string)).toBe("BODY v1\n");
    expect(files.has(extra.path)).toBe(false);
    expect(
      JSON.parse(files.get("database/project.json") as string).objects.map(
        (object: ManagedObject) => object.id,
      ),
    ).toEqual(["pkg"]);
    expect(result.objects.map((object) => object.id)).toEqual(["pkg"]);
    expect(writes).toEqual([
      `write:${pkg.path}`,
      `write:${pkg.bodyPath}`,
      `delete:${extra.path}`,
      "write:database/project.json",
    ]);
  });
});
