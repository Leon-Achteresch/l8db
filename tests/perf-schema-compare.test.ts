import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import type { CatalogObject } from "../src/lib/db";
import { compareCatalogs, defaultSelection } from "../src/lib/schema-compare/diff";
import { buildSyncScript } from "../src/lib/schema-compare/script";
import { type CompareResult, DEFAULT_COMPARE_OPTIONS } from "../src/lib/schema-compare/types";
import {
  buildCatalogSnapshot,
  parseCatalogSnapshot,
  serializeSnapshot,
} from "../src/lib/schema-snapshot";

const TABLES = 1_000;
const VIEWS = 1_000;

function catalog(schema: string, withDependencies: boolean, drift: number): CatalogObject[] {
  const objects: CatalogObject[] = [];
  for (let index = 0; index < TABLES; index++) {
    const name = `T_${index}`;
    const type = `VARCHAR2(${index % drift === 0 ? 120 : 80} BYTE)`;
    const columns = ["ID", "NAME", "CREATED_AT"].map((column) => ({
      object_type: "column" as const,
      name: column,
      parent: name,
      ddl: `"${column}" ${type}`,
      attributes: { type, nullable: column === "ID" ? "NO" : "YES" },
    }));
    objects.push(
      {
        object_type: "table",
        name,
        parent: null,
        ddl: `CREATE TABLE "${schema}"."${name}"\n(\n  ${columns.map((column) => column.ddl).join(",\n  ")}\n)`,
        attributes: {},
      },
      ...columns,
    );
  }
  for (let index = 0; index < VIEWS; index++) {
    const base = index % 10 === 9 ? `T_${index}` : `V_${index + 1}`;
    objects.push({
      object_type: "view",
      name: `V_${index}`,
      parent: null,
      ddl: `CREATE OR REPLACE VIEW "${schema}"."V_${index}" AS SELECT * FROM "${schema}"."${base}"`,
      attributes: {},
      ...(withDependencies ? { depends_on: [base] } : {}),
    });
  }
  return objects;
}

function result(source: CatalogObject[], target: CatalogObject[]): CompareResult {
  const context = {
    kind: "oracle" as const,
    sourceSchema: "DEV",
    targetSchema: "PROD",
    options: DEFAULT_COMPARE_OPTIONS,
  };
  return {
    ...context,
    source: { connectionId: null, database: null, schema: "DEV" },
    target: { connectionId: null, database: null, schema: "PROD" },
    sourceLabel: "DEV",
    targetLabel: "PROD",
    types: ["table", "view"],
    items: compareCatalogs(source, target, context),
    comparedAt: "",
  };
}

function viewsInOrder(compare: CompareResult): boolean {
  const created = new Set<string>();
  for (const statement of buildSyncScript(compare, defaultSelection(compare.items)).statements) {
    const match = /VIEW "PROD"\."(V_\d+)" AS SELECT \* FROM "PROD"\."(\w+)"/.exec(statement.sql);
    if (!match) continue;
    if (match[2].startsWith("V_") && !created.has(match[2])) return false;
    created.add(match[1]);
  }
  return created.size === VIEWS;
}

test("5k-object catalogs compare, order and round-trip within budget", async () => {
  const source = catalog("DEV", true, 7);
  const target = catalog("PROD", true, 11);
  for (let pass = 0; pass < 3; pass++) Bun.gc(true);
  const before = process.memoryUsage().heapUsed;
  const kept = result(source, target);
  for (let pass = 0; pass < 3; pass++) Bun.gc(true);
  const retainedBytes = process.memoryUsage().heapUsed - before;
  const compare = await measureScenario(() => {
    result(source, target);
  });
  const create = result(source, []);
  const createSelection = defaultSelection(create.items);
  const graph = await measureScenario(() => {
    buildSyncScript(create, createSelection);
  });
  const fallback = result(catalog("DEV", false, 7), []);
  const fallbackSelection = defaultSelection(fallback.items);
  const regex = await measureScenario(() => {
    buildSyncScript(fallback, fallbackSelection);
  }, 5);
  const snapshot = buildCatalogSnapshot(
    {
      kind: "oracle",
      connection_name: "DEV",
      database: null,
      schema: "DEV",
      types: ["table", "view"],
    },
    source,
  );
  const text = serializeSnapshot(snapshot);
  const roundTrip = await measureScenario(() => {
    parseCatalogSnapshot(serializeSnapshot(snapshot));
  });
  const script = buildSyncScript(create, createSelection);
  await reportScenario("schema-compare-catalog", {
    objectsPerSide: source.length,
    viewsWithDependencies: VIEWS,
    differences: kept.items.filter((item) => item.status !== "identical").length,
    snapshotBytes: text.length,
    compare,
    graphOrder: graph,
    regexFallbackOrder: regex,
    snapshotRoundTrip: roundTrip,
    retainedCompareBytes: retainedBytes,
    statements: script.statements.length,
  });
  expect(viewsInOrder(create)).toBe(true);
  expect(viewsInOrder(fallback)).toBe(true);
  expect(script.warnings).toEqual([]);
  expect(compare.p95Ms).toBeLessThan(400);
  expect(graph.p95Ms).toBeLessThan(250);
  expect(regex.p95Ms).toBeLessThan(1_500);
  expect(roundTrip.p95Ms).toBeLessThan(400);
  expect(retainedBytes).toBeLessThan(64 * 1024 * 1024);
});
