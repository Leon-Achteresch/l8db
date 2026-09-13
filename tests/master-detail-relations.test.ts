import { expect, test } from "bun:test";
if (typeof window === "undefined") Object.defineProperty(globalThis, "window", { value: { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } }, configurable: true });
const { masterDetailRelations, masterDetailRelationSql } = await import("../src/lib/master-detail-relations");
const { bindMasterDetail } = await import("../src/lib/master-detail");

const keys = [
  { constraint_name: "customer_fk", from_schema: "sales", from_table: "orders", from_column: "customer_id", to_schema: "crm", to_table: "customers", to_column: "id" },
  { constraint_name: "customer_fk", from_schema: "sales", from_table: "orders", from_column: "tenant_id", to_schema: "crm", to_table: "customers", to_column: "tenant" },
];

test("generates parent and child SQL with complete composite keys", () => {
  const parent = masterDetailRelations(keys, "sales", "orders");
  expect(parent).toHaveLength(1);
  expect(masterDetailRelationSql(parent[0], "oracle")).toBe('SELECT *\nFROM "crm"."customers"\nWHERE "id" = :master.customer_id\n  AND "tenant" = :master.tenant_id\nFETCH FIRST 100 ROWS ONLY');
  const child = masterDetailRelations(keys, "crm", "customers");
  expect(child[0].direction).toBe("child");
  const sql = masterDetailRelationSql(child[0], "postgres");
  expect(sql).toContain('"customer_id" = :master.id\n  AND "tenant_id" = :master.tenant');
  expect(bindMasterDetail(sql, null, { id: 12, tenant: "A" }).params).toEqual(["12", "A"]);
});

test("keeps separate constraints, self references and quotes provider identifiers", () => {
  const self = { ...keys[0], to_schema: "sales", to_table: "orders" };
  expect(masterDetailRelations([self], "sales", "orders")).toHaveLength(2);
  expect(masterDetailRelations([...keys, { ...keys[0], constraint_name: "second_fk" }], "sales", "orders")).toHaveLength(2);
  const relation = masterDetailRelations([{ ...keys[0], from_column: "Customer ID" }], "sales", "orders")[0];
  expect(masterDetailRelationSql(relation, "mssql")).toBe('SELECT TOP (100) *\nFROM [crm].[customers]\nWHERE [id] = :master."Customer ID"');
  expect(masterDetailRelationSql(relation, "mysql")).toContain('FROM `crm`.`customers`');
});
