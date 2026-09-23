import { describe, expect, test } from "bun:test";
import { mappedMigration } from "../src/lib/versioning/deploy";
import {
  checksum,
  identifier,
  parseProject,
  parseRelease,
  validateMigration,
  validateReleaseGraph,
} from "../src/lib/versioning/model";
import { portableOracleMetadata } from "../src/lib/versioning/oracle-metadata";
import {
  checkResult,
  defaultSafety,
  releaseRisks,
  requiresMaintenance,
  validateCheck,
  validateProductionRelease,
  validateSafety,
} from "../src/lib/versioning/safety";
import { requalify } from "../src/lib/versioning/schema";
import { sqlCode } from "../src/lib/versioning/sql-code";
import { pendingVersioningCount } from "../src/lib/versioning/status";
import type {
  DatabaseRelease,
  DatabaseTarget,
  ReleaseCheck,
  TargetStore,
  VersioningProject,
} from "../src/lib/versioning/types";

const project: VersioningProject = {
  format: 1,
  id: "product",
  name: "Product",
  kind: "postgres",
  objects: [],
};
const release = (id: string, parent: string | null, track = "main"): DatabaseRelease => ({
  format: 1,
  id,
  parent,
  track,
  projectId: project.id,
  kind: "postgres",
  createdAt: "2026-09-21T00:00:00Z",
  objects: [],
  migrations: [],
});
const check = async (
  sql = "SELECT COUNT(*) FROM orders",
  expected = "0",
): Promise<ReleaseCheck> => ({
  id: "orders-empty",
  title: "Orders",
  sql,
  expected,
  checksum: await checksum(sql),
});

describe("release graph and customer policy", () => {
  test("rejects missing JSON identities instead of coercing undefined", () => {
    expect(identifier(undefined as unknown as string)).toBe(false);
    expect(() => parseProject(JSON.stringify({ ...project, id: undefined }))).toThrow();
  });
  test("rejects two files owning the same database object", () => {
    const object = {
      id: "one",
      path: "database/objects/one.sql",
      selection: { schema: "public", objectName: "orders", objectType: "table" },
    };
    expect(() =>
      parseProject(
        JSON.stringify({
          ...project,
          objects: [object, { ...object, id: "two", path: "database/objects/two.sql" }],
        }),
      ),
    ).toThrow("Objektzuordnung");
    expect(() =>
      parseProject(
        JSON.stringify({
          ...project,
          objects: [
            { ...object, selection: { ...object.selection, objectName: "L8DB_VERSIONING_STATE" } },
          ],
        }),
      ),
    ).toThrow();
  });
  test("validates migration IDs against the whole applied ancestry", () => {
    const migration = { id: "backfill-once", title: "Backfill", sql: "SELECT 1", checksum: "" };
    expect(() =>
      validateReleaseGraph([
        { ...release("v1", null), migrations: [migration] },
        release("v2", "v1"),
        { ...release("v3", "v2"), migrations: [migration] },
      ]),
    ).toThrow("bereits verwendet");
  });
  test("supports independent baselines and branching from a common product release", () => {
    expect(() =>
      validateReleaseGraph([
        release("v1", null),
        release("v2", "v1"),
        release("acme-1", "v1", "acme"),
        release("acme-2", "acme-1", "acme"),
        release("legacy-0", null, "legacy"),
      ]),
    ).not.toThrow();
  });
  test("blocks a customer hotfix leaking into another release line", () => {
    expect(() =>
      validateReleaseGraph([
        release("v1", null),
        release("acme-1", "v1", "acme"),
        release("v2", "acme-1"),
      ]),
    ).toThrow("fremde");
  });
  test.each([
    [release("v1", "v2"), release("v2", "v1")],
    [release("v1", "missing")],
    [release("v1", null), release("v1", null)],
  ])("rejects corrupt graph %j", (...versions) =>
    expect(() => validateReleaseGraph(versions)).toThrow(),
  );
  test("badge respects holds, release limits and deliberate variants", () => {
    const versions = [
      release("v1", null),
      release("v2", "v1"),
      release("v3", "v2"),
      release("acme", "v1", "acme"),
    ];
    const target = {
      id: "a",
      name: "A",
      connectionId: "a",
      database: null,
      production: false,
      release: { id: "v2", path: "database/releases/v2.json", commit: "a".repeat(40) },
      history: [],
    };
    const store: TargetStore = { format: 1, projectId: "product", targets: [target] };
    expect(pendingVersioningCount(null, versions, store, false)).toBe(1);
    expect(
      pendingVersioningCount(
        null,
        versions,
        { ...store, targets: [{ ...target, paused: true }] },
        false,
      ),
    ).toBe(0);
    expect(
      pendingVersioningCount(
        null,
        versions,
        { ...store, targets: [{ ...target, pinnedRelease: "v2" }] },
        false,
      ),
    ).toBe(0);
    expect(
      pendingVersioningCount(
        null,
        versions,
        { ...store, targets: [{ ...target, track: "acme" }] },
        false,
      ),
    ).toBe(0);
  });
});

describe("operational SQL checks", () => {
  test.each([
    "SELECT 1; SELECT 2",
    "UPDATE orders SET id = 1",
    "SELECT * INTO copied FROM orders",
    "SELECT * FROM orders FOR UPDATE",
    "SELECT nextval('orders_seq')",
    "SELECT set_config('lock_timeout', '0', true)",
  ])("rejects unsafe check %s", (sql) => expect(() => validateCheck(sql, "postgres")).toThrow());
  test("allows aggregate checks with literal keywords and nested comments", () => {
    expect(() =>
      validateCheck(
        "/* outer /* inner */ ok */ SELECT COUNT(*) FROM orders WHERE note = 'UPDATE; DROP'",
        "postgres",
      ),
    ).not.toThrow();
    expect(() =>
      validateCheck("SELECT CASE WHEN 1=1 THEN 'ok' ELSE 'error' END FROM dual", "oracle"),
    ).not.toThrow();
  });
  test("scalar comparisons preserve exact values without exposing returned data", async () => {
    const entry = await check();
    expect(() => checkResult({ columns: ["count"], rows: [{ count: "0" }] }, entry)).not.toThrow();
    expect(() => checkResult({ columns: ["count"], rows: [{ count: 0 }] }, entry)).not.toThrow();
    for (const rows of [[], [{ count: null }], [{ count: 0 }, { count: 0 }]])
      expect(() => checkResult({ columns: ["count"], rows }, entry)).toThrow();
    expect(() =>
      checkResult({ columns: ["count", "other"], rows: [{ count: 0, other: 0 }] }, entry),
    ).toThrow();
    try {
      checkResult({ columns: ["count"], rows: [{ count: "private customer value" }] }, entry);
    } catch (error) {
      expect(String(error)).not.toContain("private customer value");
    }
  });
  test("checksums and timeouts are validated when loading a release", async () => {
    const safety = { ...defaultSafety(), postconditions: [await check()] };
    const value = { ...release("v1", null), safety };
    await expect(parseRelease(JSON.stringify(value), project)).resolves.toEqual(value);
    await expect(
      parseRelease(
        JSON.stringify({
          ...value,
          safety: {
            ...safety,
            postconditions: [{ ...safety.postconditions[0], sql: "SELECT 99" }],
          },
        }),
        project,
      ),
    ).rejects.toThrow("veränderte");
    for (const lockTimeoutMs of [0, -1, 60001, 1.5])
      await expect(validateSafety({ ...safety, lockTimeoutMs }, "postgres")).rejects.toThrow();
    await expect(
      validateSafety({ ...safety, statementTimeoutMs: 100 }, "postgres"),
    ).rejects.toThrow();
    await expect(
      validateSafety({ ...safety, preconditions: safety.postconditions }, "postgres"),
    ).rejects.toThrow("doppelte");
  });
  test("production requires operational notes and a result check", async () => {
    const value = { ...release("v2", "v1"), safety: defaultSafety() };
    expect(() => validateProductionRelease(value)).toThrow("Betriebsplan");
    value.safety.notes = "App v2 accepts v1 and v2 schemas; restore from tested snapshot.";
    expect(() => validateProductionRelease(value)).toThrow("Nachprüfung");
    value.safety.postconditions = [await check()];
    expect(() => validateProductionRelease(value)).not.toThrow();
    value.safety.phase = "contract";
    expect(() => validateProductionRelease(value)).toThrow("Wartungsplan");
    value.safety.compatibility = "maintenance";
    expect(() => validateProductionRelease(value)).not.toThrow();
  });
  test.each([
    "SET LOCAL lock_timeout = 0",
    "/* a /* b */ c */ RESET ALL",
    "ALTER SESSION SET CURRENT_SCHEMA = another",
    'UPDATE "L8DB_VERSIONING_STATE" SET "STATUS" = \'ready\'',
    "SELECT pg_catalog.set_config('search_path','other',true)",
  ])("protects managed session settings: %s", (sql) =>
    expect(() => validateMigration(sql, "postgres")).toThrow(),
  );
  test("does not mistake string contents for operations", () => {
    const sql = "INSERT INTO notes VALUES ('DROP TABLE orders; -- /*', E'escaped\\'value');";
    expect(sqlCode(sql)).not.toContain("DROP TABLE");
    const value = {
      ...release("v2", "v1"),
      migrations: [{ id: "one", title: "Notes", sql, checksum: "" }],
    };
    expect(requiresMaintenance(value)).toBe(false);
  });
  test("Oracle package replacement highlights existing session state", () => {
    const value = {
      ...release("v2", "v1"),
      kind: "oracle" as const,
      migrations: [
        {
          id: "one",
          title: "Package",
          sql: "CREATE OR REPLACE PACKAGE BODY app.pkg AS END;\n/",
          checksum: "",
        },
      ],
    };
    expect(releaseRisks(value).some((risk) => risk.includes("ORA-04068"))).toBe(true);
    expect(() => validateMigration("BEGIN COMMIT; END;\n/", "oracle")).toThrow();
    expect(() =>
      validateMigration(
        "CREATE OR REPLACE PACKAGE BODY p AS PROCEDURE save IS BEGIN COMMIT; END; END;\n/",
        "oracle",
      ),
    ).not.toThrow();
  });
  test("schema remapping refuses quoted names hidden in executable dollar bodies", () => {
    expect(() =>
      requalify('DO $$ BEGIN UPDATE "public" . orders SET id = 1; END $$;', "public", "tenant"),
    ).toThrow("Dollar-String");
    expect(requalify("SELECT 'public.orders' FROM public.orders", "public", "tenant")).toBe(
      "SELECT 'public.orders' FROM \"tenant\".orders",
    );
  });
  test("customer remapping blocks writes to a different explicit schema", () => {
    const mapped = {
      ...release("v2", "v1"),
      objects: [{ object: { selection: { schema: "public" } } }],
    } as unknown as DatabaseRelease;
    const target = { schema: "tenant_a" } as DatabaseTarget;
    expect(
      mappedMigration("ALTER TABLE public.invoices ADD COLUMN note text", target, mapped),
    ).toContain('"tenant_a".invoices');
    for (const sql of [
      "UPDATE tenant_b.invoices SET amount = 0",
      "DELETE FROM tenant_b.invoices",
      "CREATE INDEX x ON tenant_b.invoices(id)",
      "DROP TABLE tenant_b.invoices",
      "CREATE TRIGGER t AFTER UPDATE ON tenant_b.invoices EXECUTE FUNCTION f()",
    ])
      expect(() => mappedMigration(sql, target, mapped)).toThrow("zugeordnete Kundenschema");
    expect(() =>
      mappedMigration(
        "CREATE OR REPLACE PACKAGE BODY OTHER.P AS END P;",
        { schema: "TENANT_A" } as DatabaseTarget,
        {
          ...mapped,
          kind: "oracle",
          objects: [{ object: { selection: { schema: "DEV" } } }],
        } as DatabaseRelease,
      ),
    ).toThrow("zugeordnete Kundenschema");
    expect(() =>
      mappedMigration("DROP TABLE tenant_a.invoices, tenant_b.invoices", target, mapped),
    ).toThrow("getrennt");
    expect(mappedMigration("SELECT 'UPDATE tenant_b.invoices'", target, mapped)).toContain(
      "tenant_b",
    );
  });
});

describe("portable Oracle table metadata", () => {
  const constraint = {
    name: "SYS_C001",
    constraint_type: "PRIMARY KEY",
    columns: ["ID"],
    definition: "PRIMARY KEY (ID)",
  };
  const row = {
    name: "SYS_C001",
    generated: "GENERATED NAME",
    status: "ENABLED",
    validated: "VALIDATED",
    deferrable: "NOT DEFERRABLE",
    deferred: "IMMEDIATE",
  };
  test("generated constraint names compare equally across customers", async () => {
    const first = await portableOracleMetadata([constraint], [], [row], "DEV", "DEV");
    const second = await portableOracleMetadata(
      [{ ...constraint, name: "SYS_C987" }],
      [],
      [{ ...row, name: "SYS_C987" }],
      "CUSTOMER",
      "DEV",
    );
    expect(first.constraints).toEqual(second.constraints);
    expect(first.constraints[0].name).toStartWith("L8DB_GENERATED_");
  });
  test("explicitly named constraints and SQL literal contents remain intact", async () => {
    const explicit = await portableOracleMetadata(
      [{ ...constraint, definition: "CHECK (note = 'SYS_C001')" }],
      [],
      [{ ...row, generated: "USER NAME" }],
      "DEV",
      "DEV",
    );
    expect(explicit.constraints[0].name).toBe("SYS_C001");
    expect(explicit.constraints[0].definition).toContain("'SYS_C001'");
  });
  test("disabled and unvalidated constraints remain observable", async () => {
    const first = await portableOracleMetadata([constraint], [], [row], "DEV", "DEV");
    const second = await portableOracleMetadata(
      [constraint],
      [],
      [{ ...row, status: "DISABLED", validated: "NOT VALIDATED" }],
      "DEV",
      "DEV",
    );
    expect(first.constraints).not.toEqual(second.constraints);
    await expect(portableOracleMetadata([constraint], [], [], "DEV", "DEV")).rejects.toThrow(
      "unvollständig",
    );
  });
  test("foreign key target and delete behavior participate in the comparison", async () => {
    const fk = { ...constraint, constraint_type: "FOREIGN KEY", definition: "FOREIGN KEY (ID)" };
    const reference = {
      ...row,
      referenced_schema: "DEV",
      referenced_table: "PARENT",
      referenced_columns: "ID",
      delete_rule: "NO ACTION",
    };
    const first = await portableOracleMetadata([fk], [], [reference], "DEV", "DEV");
    const second = await portableOracleMetadata(
      [fk],
      [],
      [{ ...reference, referenced_table: "OTHER" }],
      "DEV",
      "DEV",
    );
    expect(first.constraints).not.toEqual(second.constraints);
    expect(first.constraints[0].definition).toContain('REFERENCES "DEV"."PARENT"');
  });
});
