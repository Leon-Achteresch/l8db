import { heapSize } from "bun:jsc";
import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import type { CatalogObject } from "../src/lib/db";
import {
  compareCatalogs,
  defaultSelection,
  limitDifferences,
} from "../src/lib/schema-compare/diff";
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
      ...(withDependencies
        ? { depends_on: [`${base.startsWith("T_") ? "table" : "view"}:${base}`] }
        : {}),
    });
  }
  return objects;
}

function result(
  source: CatalogObject[],
  target: CatalogObject[],
  kind: "oracle" | "sqlite" = "oracle",
  options = DEFAULT_COMPARE_OPTIONS,
): CompareResult {
  const context = {
    kind,
    sourceSchema: "DEV",
    targetSchema: "PROD",
    options,
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
  const before = heapSize();
  const kept = result(source, target);
  for (let pass = 0; pass < 3; pass++) Bun.gc(true);
  const retainedBytes = heapSize() - before;
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

test("5k-object sync script rebuild per checkbox click stays bounded for every path", async () => {
  const source = catalog("DEV", true, 7);
  const target = catalog("PROD", true, 11);
  const all = (compare: CompareResult) =>
    Object.fromEntries(compare.items.map((item) => [item.key, item.status !== "identical"]));
  const dropped = result([], target);
  const dropSelection = all(dropped);
  const drop = await measureScenario(() => {
    buildSyncScript(dropped, dropSelection);
  });
  const altered = result(source, target);
  const alterSelection = defaultSelection(altered.items);
  const alter = await measureScenario(() => {
    buildSyncScript(altered, alterSelection);
  });
  const renameColumn = (list: CatalogObject[], name: string) =>
    list.map((object) =>
      object.object_type === "column" && object.name === "NAME" ? { ...object, name } : object,
    );
  const renaming = result(renameColumn(source, "FULL_NAME"), renameColumn(target, "OLD_NAME"));
  const renameSelection = all(renaming);
  const renames = Object.fromEntries(
    renaming.items
      .filter((item) => item.name === "FULL_NAME")
      .map((item) => [item.key, item.key.replace("FULL_NAME", "OLD_NAME")]),
  );
  const rename = await measureScenario(() => {
    buildSyncScript(renaming, renameSelection, renames);
  });
  const tables = (list: CatalogObject[], type: string) =>
    list
      .filter((object) => object.object_type === "table" || object.object_type === "column")
      .map((object) =>
        object.object_type === "column" && object.name === "ID"
          ? { ...object, attributes: { ...object.attributes, type } }
          : object,
      );
  const rebuilt = result(tables(source, "INTEGER"), tables(target, "TEXT"), "sqlite");
  const rebuildSelection = defaultSelection(rebuilt.items);
  const rebuild = await measureScenario(() => {
    buildSyncScript(rebuilt, rebuildSelection);
  });
  const limited = limitDifferences(altered.items, 100);
  const capped = { ...altered, items: limited.items, omitted: limited.omitted };
  const limit = await measureScenario(() => {
    buildSyncScript(capped, alterSelection);
  });
  const exclude = await measureScenario(() => {
    result(source, target, "oracle", {
      ...DEFAULT_COMPARE_OPTIONS,
      excludePatterns: "T\\_1%, V\\_2%",
    });
  });
  const sizes = {
    drop: buildSyncScript(dropped, dropSelection).statements.length,
    alter: buildSyncScript(altered, alterSelection).statements.length,
    rename: buildSyncScript(renaming, renameSelection, renames).statements.filter((statement) =>
      statement.sql.includes("RENAME COLUMN"),
    ).length,
    rebuild: buildSyncScript(rebuilt, rebuildSelection).statements.length,
    limit: buildSyncScript(capped, alterSelection).statements.length,
  };
  await reportScenario("schema-compare-script-paths", {
    objectsPerSide: source.length,
    note: "buildSyncScript runs again on every selection click",
    drop,
    alter,
    rename,
    sqliteRebuild: rebuild,
    limit,
    excludeCompare: exclude,
    statements: sizes,
  });
  expect(sizes.rename).toBe(TABLES);
  expect(sizes.limit).toBe(0);
  expect(sizes.rebuild).toBeGreaterThan(TABLES * 4);
  for (const scenario of [drop, alter, rename, rebuild, limit])
    expect(scenario.p95Ms).toBeLessThan(150);
  expect(exclude.p95Ms).toBeLessThan(400);
});
