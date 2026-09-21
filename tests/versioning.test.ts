import { describe, expect, test } from "bun:test";
import {
  checksum,
  compareSnapshots,
  parseProject,
  parseRelease,
  releaseChain,
  validateMigration,
} from "../src/lib/versioning/model";
import { changedFiles, pendingVersioningCount } from "../src/lib/versioning/status";
import type {
  DatabaseRelease,
  ManagedObject,
  RepositoryStatus,
  TargetStore,
  VersioningProject,
} from "../src/lib/versioning/types";

const object: ManagedObject = {
  id: "orders",
  path: "database/objects/orders.sql",
  selection: { schema: "public", objectType: "table", objectName: "orders", objectOid: null },
};
const project: VersioningProject = {
  format: 1,
  id: "product",
  name: "Product",
  kind: "postgres",
  objects: [object],
};
const release = (id: string, parent: string | null): DatabaseRelease => ({
  format: 1,
  id,
  parent,
  projectId: project.id,
  kind: project.kind,
  createdAt: "2026-09-20T12:00:00Z",
  objects: [],
  migrations: [],
});

describe("database versioning integrity", () => {
  test("normalizes platform newlines without hiding SQL literal changes", async () => {
    expect(await checksum("select 'A'\r\n")).toBe(await checksum("select 'A'\n"));
    expect(await checksum("select 'A'")).not.toBe(await checksum("select 'a'"));
  });
  test("rejects duplicate identities and paths", () => {
    expect(() => parseProject(JSON.stringify({ ...project, objects: [object, object] }))).toThrow();
    expect(() =>
      parseProject(
        JSON.stringify({ ...project, objects: [{ ...object, path: "database/../secret.sql" }] }),
      ),
    ).toThrow();
  });
  test("release checksums protect both SQL and definitions", async () => {
    const source = "CREATE TABLE public.orders(id int)";
    const value = {
      ...release("v1", null),
      objects: [{ object, definition: source, checksum: await checksum(source) }],
      migrations: [{ id: "v1-1", title: "Create", sql: source, checksum: await checksum(source) }],
    };
    expect((await parseRelease(JSON.stringify(value), project)).id).toBe("v1");
    await expect(
      parseRelease(
        JSON.stringify({
          ...value,
          objects: [{ ...value.objects[0], definition: `${source}; drop table other` }],
        }),
        project,
      ),
    ).rejects.toThrow("Prüfsumme");
    await expect(
      parseRelease(
        JSON.stringify({
          ...value,
          migrations: [{ ...value.migrations[0], sql: "DROP TABLE public.orders" }],
        }),
        project,
      ),
    ).rejects.toThrow("Prüfsumme");
  });
  test("customers on different versions receive different ordered plans", () => {
    const versions = [release("v1", null), release("v2", "v1"), release("v3", "v2")];
    expect(releaseChain(versions, "v1", "v3").map((value) => value.id)).toEqual(["v2", "v3"]);
    expect(releaseChain(versions, "v2", "v3").map((value) => value.id)).toEqual(["v3"]);
    expect(releaseChain(versions, "v3", "v3")).toEqual([]);
    expect(() => releaseChain(versions, "v3", "v1")).toThrow("Nachfolger");
  });
  test("missing versions, cycles and repeated migrations block rollout", () => {
    expect(() => releaseChain([release("v3", "v2")], "v1", "v3")).toThrow("fehlt");
    expect(() => releaseChain([release("v2", "v3"), release("v3", "v2")], "v1", "v3")).toThrow(
      "Zyklische",
    );
    const migration = { id: "same", title: "same", sql: "select 1", checksum: "" };
    expect(() =>
      releaseChain(
        [
          { ...release("v2", "v1"), migrations: [migration] },
          { ...release("v3", "v2"), migrations: [migration] },
        ],
        "v1",
        "v3",
      ),
    ).toThrow("eindeutig");
  });
  test("drift includes missing and unmanaged objects", async () => {
    const before = { object, definition: "old", checksum: await checksum("old") };
    const after = { object, definition: "new", checksum: await checksum("new") };
    expect(compareSnapshots([before], [after])[0].status).toBe("changed");
    expect(compareSnapshots([before], [before])[0].status).toBe("unchanged");
    expect(compareSnapshots([before], [])[0].status).toBe("missing");
    expect(compareSnapshots([], [after])[0].status).toBe("unmanaged");
  });
});

describe("migration boundaries", () => {
  for (const sql of [
    "COMMIT;",
    "ROLLBACK;",
    "BEGIN; SELECT 1; COMMIT;",
    "END;",
    "START TRANSACTION;",
    "SAVEPOINT a;",
    "SET ROLE admin;",
    "ALTER SESSION SET CURRENT_SCHEMA=other",
    "CREATE INDEX CONCURRENTLY test ON invoices(id)",
    "VACUUM invoices",
  ]) {
    test(`blocks session control or nontransactional PostgreSQL: ${sql}`, () =>
      expect(() => validateMigration(sql, "postgres")).toThrow());
  }
  test("handles semicolons inside PostgreSQL function bodies", () => {
    expect(
      validateMigration(
        "CREATE OR REPLACE FUNCTION public.x() RETURNS int LANGUAGE plpgsql AS $$ BEGIN RETURN 1; END; $$; SELECT 2;",
        "postgres",
      ),
    ).toHaveLength(2);
  });
  test("handles Oracle package specification and body as complete units", () => {
    const sql =
      "CREATE OR REPLACE PACKAGE app.p AS PROCEDURE run; END;\n/\nCREATE OR REPLACE PACKAGE BODY app.p AS PROCEDURE run IS BEGIN NULL; END; END;\n/";
    expect(validateMigration(sql, "oracle")).toHaveLength(2);
  });
  test("rejects unresolved merge markers and unterminated SQL", () => {
    expect(() =>
      validateMigration("<<<<<<< Kunde\nselect 1\n=======\nselect 2\n>>>>>>> Produkt", "postgres"),
    ).toThrow("Merge");
    expect(() => validateMigration("SELECT 'unfinished", "postgres")).toThrow();
  });
});

describe("schema mapping", () => {
  test("maps identifiers without modifying comments and quoted data", async () => {
    const { requalify } = await import("../src/lib/versioning/schema");
    const sql = `CREATE OR REPLACE PACKAGE BODY DEV.P AS v varchar2(30) := 'DEV.P'; PROCEDURE run IS BEGIN DEV.helper; END; END; -- DEV.P`;
    const mapped = requalify(sql, "DEV", "CUSTOMER");
    expect(mapped).toContain('PACKAGE BODY "CUSTOMER".P');
    expect(mapped).toContain('"CUSTOMER".helper');
    expect(mapped).toContain("'DEV.P'");
    expect(mapped).toContain("-- DEV.P");
    expect(requalify(`SELECT q'[DEV.P]' FROM DEV.t`, "DEV", "A")).toBe(
      `SELECT q'[DEV.P]' FROM "A".t`,
    );
    expect(requalify(`SELECT "DEV".t, OTHER.DEV FROM DEV.t`, "DEV", "A")).toBe(
      `SELECT "A".t, OTHER.DEV FROM "A".t`,
    );
  });
  test("requires explicit migration for opaque function bodies containing mapped schema", async () => {
    const { requalify } = await import("../src/lib/versioning/schema");
    expect(() =>
      requalify(
        "CREATE FUNCTION DEV.f() RETURNS int AS $$SELECT DEV.g()$$ LANGUAGE sql",
        "DEV",
        "A",
      ),
    ).toThrow("Dollar");
  });
});

describe("versioning sidebar attention", () => {
  const repository = (changes = ""): RepositoryStatus => ({
    repo: "/repo",
    head: "a".repeat(40),
    branch: "main",
    branches: ["main"],
    files: [],
    history: "",
    changes,
  });
  const targets = (ids: string[]): TargetStore => ({
    format: 1,
    projectId: "product",
    targets: ids.map((id, index) => ({
      id: String(index),
      name: `Customer ${index}`,
      connectionId: "connection",
      database: null,
      production: false,
      release: { id, commit: "a".repeat(40), path: `database/releases/${id}.json` },
      history: [],
    })),
  });
  test("counts a renamed file once and preserves paths with spaces", () => {
    expect([
      ...changedFiles(
        "R  database/new package.pkb\0database/old package.pkb\0 M database/table.sql\0?? database/new.sql\0",
      ),
    ]).toEqual([
      ["database/new package.pkb", "R"],
      ["database/table.sql", "M"],
      ["database/new.sql", "??"],
    ]);
  });
  test("includes unsaved drafts and clears resolved changes", () => {
    expect(pendingVersioningCount(repository(" M database/table.sql\0"), [], null, true)).toBe(2);
    expect(pendingVersioningCount(repository(), [], null, false)).toBe(0);
  });
  test("counts each outdated target once and ignores unrelated release lines", () => {
    const versions = [
      release("v1", null),
      release("v2", "v1"),
      release("v3", "v2"),
      release("custom", null),
    ];
    expect(
      pendingVersioningCount(repository(), versions, targets(["v1", "v2", "v3", "custom"]), false),
    ).toBe(2);
  });
  test("an uncommitted release is a file change, not a deployable update", () => {
    expect(
      pendingVersioningCount(
        repository("?? database/releases/v2.json\0"),
        [release("v1", null), release("v2", "v1")],
        targets(["v1"]),
        false,
      ),
    ).toBe(1);
  });
  test("retains attention for failed deployments and missing baselines", () => {
    const store = targets(["v1", "v1"]);
    store.targets[0].release = null;
    store.targets[1].history = [
      {
        id: "failed",
        startedAt: "2026-09-20",
        finishedAt: null,
        from: null,
        to: { id: "v1", path: "database/releases/v1.json", commit: "a".repeat(40) },
        status: "failed",
        completedMigrations: [],
        error: "Review required",
      },
    ];
    expect(pendingVersioningCount(repository(), [release("v1", null)], store, false)).toBe(2);
    store.targets[1].history[0].status = "reconciled";
    expect(pendingVersioningCount(repository(), [release("v1", null)], store, false)).toBe(1);
  });
  test("cyclic unrelated release lines cannot stall badge calculation", () => {
    expect(
      pendingVersioningCount(
        repository(),
        [release("a", "b"), release("b", "a")],
        targets(["v1"]),
        false,
      ),
    ).toBe(0);
  });
});
