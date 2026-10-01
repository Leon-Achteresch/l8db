import { expect, test } from "bun:test";
import { buildCompareApplyPlan } from "../src/lib/compare-apply-plan";
import { EMPTY_COMPARE_SIDE } from "../src/lib/compare-types";
import { generateMigration } from "../src/lib/versioning/migrations";
import { checksum } from "../src/lib/versioning/model";
import type { DatabaseRelease, ObjectSnapshot } from "../src/lib/versioning/types";

const side = { ...EMPTY_COMPARE_SIDE, schema: "public", objectName: "customers" };
const before =
  "TABLE public.customers\nCOLUMNS\n  id integer NOT NULL PRIMARY KEY\n  name text NULL\nCONSTRAINTS\ncustomers_id_not_null n (id) NOT NULL id\ncustomers_pkey PRIMARY KEY (id) PRIMARY KEY (id)\nINDEXES\n  CREATE UNIQUE INDEX customers_pkey ON public.customers USING btree (id)";
const after = before
  .replace("\nCONSTRAINTS", "\n  active boolean NOT NULL DEFAULT true\nCONSTRAINTS")
  .replace(
    "\ncustomers_id_not_null",
    "\ncustomers_active_not_null n (active) NOT NULL active\ncustomers_id_not_null",
  );

test("PostgreSQL 18 adds a required column without treating its automatic not-null constraint as manual work", () => {
  expect(buildCompareApplyPlan("postgres", side, before, after)).toEqual([
    'ALTER TABLE "public"."customers" ADD COLUMN "active" boolean DEFAULT true NOT NULL;',
  ]);
});

test("PostgreSQL 18 changes nullability while retaining all other constraints and indexes", () => {
  const changed = before
    .replace("name text NULL", "name text NOT NULL")
    .replace(
      "\ncustomers_pkey",
      "\ncustomers_name_not_null n (name) NOT NULL name\ncustomers_pkey",
    );
  expect(buildCompareApplyPlan("postgres", side, before, changed)).toEqual([
    'ALTER TABLE "public"."customers" ALTER COLUMN "name" SET NOT NULL;',
  ]);
  expect(buildCompareApplyPlan("postgres", side, changed, before)).toEqual([
    'ALTER TABLE "public"."customers" ALTER COLUMN "name" DROP NOT NULL;',
  ]);
  for (const invalid of [
    after.replace("customers_active_not_null", "custom_required_active"),
    after.replace("NOT NULL active", "NOT NULL active NO INHERIT"),
    after.replace("active boolean NOT NULL", "active boolean NULL"),
    `${after}\n  CREATE INDEX customers_name ON public.customers (name)`,
    `${after}\nTRIGGERS\ncustomers_active_not_null n (active) NOT NULL active`,
  ])
    expect(() => buildCompareApplyPlan("postgres", side, before, invalid)).toThrow("Constraints");
});

const snapshot = async (definition: string): Promise<ObjectSnapshot> => ({
  object: {
    id: "customers",
    path: "database/objects/customers.sql",
    selection: { schema: "public", objectName: "customers", objectType: "table", objectOid: null },
  },
  definition,
  checksum: await checksum(definition),
});
const baseline = (objects: ObjectSnapshot[]): DatabaseRelease => ({
  format: 1,
  id: "1.0.0",
  projectId: "project",
  kind: "postgres",
  parent: null,
  createdAt: "2026-10-01T00:00:00Z",
  objects,
  migrations: [],
});

test("release generation handles PostgreSQL 18 not-null catalog entries for changed and new tables", async () => {
  const previous = await snapshot(before);
  const current = await snapshot(after);
  const changed = generateMigration("postgres", baseline([previous]), [current]);
  expect(changed.issues).toEqual([]);
  expect(changed.sql).toBe(
    'ALTER TABLE "public"."customers" ADD COLUMN "active" boolean DEFAULT true NOT NULL;',
  );
  const added = generateMigration("postgres", baseline([]), [current]);
  expect(added.issues).toEqual([]);
  expect(added.sql).toContain('"active" boolean DEFAULT true NOT NULL');
  expect(added.sql).toContain('CONSTRAINT "customers_pkey" PRIMARY KEY (id)');
  expect(added.sql).not.toContain("customers_active_not_null");
  const named = generateMigration("postgres", baseline([]), [
    await snapshot(after.replace("customers_active_not_null", "custom_required_active")),
  ]);
  expect(named.issues).toHaveLength(1);
  expect(named.sql).toBe("");
});
