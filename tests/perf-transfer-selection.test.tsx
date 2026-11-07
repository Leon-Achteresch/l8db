import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TransferTableList } from "../src/features/transfer/transfer-table-list";
import type { CatalogObject } from "../src/lib/db";
import { selectTables } from "../src/lib/transfer/native-script";

function stats(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return {
    median: sorted[Math.floor(sorted.length / 2)],
    p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
  };
}

test("table picker renders a bounded window for 50 000 tables", () => {
  const items = Array.from({ length: 50_000 }, (_, index) => ({
    key: `table:TABELLE_${index}`,
    name: `TABELLE_${index}`,
    type: "table",
  }));
  const chosen = new Set(items.slice(0, 25_000).map((item) => item.key));
  const samples: number[] = [];
  let markup = "";
  for (let run = 0; run < 15; run++) {
    const started = performance.now();
    markup = renderToStaticMarkup(
      createElement(TransferTableList, { schema: "APP", items, chosen, onToggle: () => {} }),
    );
    samples.push(performance.now() - started);
  }
  const { median, p95 } = stats(samples);
  const rows = markup.match(/data-table=/g)?.length ?? 0;
  console.log(
    `transfer table picker 50k tables: median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, ${rows} DOM rows`,
  );
  expect(rows).toBeGreaterThan(0);
  expect(rows).toBeLessThanOrEqual(24);
  expect(median).toBeLessThan(30);
  expect(p95).toBeLessThan(80);
});

test("table selection filters a 652 000 object catalog quickly", () => {
  const catalog: CatalogObject[] = [];
  for (let index = 0; index < 2_000; index++)
    catalog.push({
      object_type: "sequence",
      name: `S${index}`,
      parent: null,
      ddl: `CREATE SEQUENCE "APP"."S${index}"`,
      attributes: {},
    });
  for (let index = 0; index < 50_000; index++) {
    const table = `T${index}`;
    catalog.push({
      object_type: "table",
      name: table,
      parent: null,
      ddl: `CREATE TABLE "APP"."${table}" ("ID" NUMBER DEFAULT "APP"."S${index % 2_000}"."NEXTVAL", "NAME" VARCHAR2(40))`,
      attributes: {},
    });
    for (let column = 0; column < 10; column++)
      catalog.push({
        object_type: "column",
        name: `C${column}`,
        parent: table,
        ddl: "",
        attributes: {},
      });
    catalog.push({
      object_type: "constraint",
      name: `${table}_FK`,
      parent: table,
      ddl: "",
      attributes: { references: `T${(index + 1) % 50_000}` },
    });
    catalog.push({
      object_type: "index",
      name: `${table}_IX`,
      parent: table,
      ddl: "",
      attributes: {},
    });
  }
  const tables = Array.from({ length: 5_000 }, (_, index) => `T${index * 10}`);
  const samples: number[] = [];
  let kept = 0;
  let dropped = 0;
  for (let run = 0; run < 9; run++) {
    const started = performance.now();
    const result = selectTables(catalog, tables);
    samples.push(performance.now() - started);
    kept = result.objects.length;
    dropped = result.warnings.length;
  }
  const { median, p95 } = stats(samples);
  console.log(
    `transfer table selection: ${catalog.length} objects, ${tables.length} tables, median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`,
  );
  expect(kept).toBe(5_000 * 12 + 200);
  expect(dropped).toBe(5_000);
  expect(median).toBeLessThan(150);
  expect(p95).toBeLessThan(300);
});

test("object selection with picked code objects stays fast on 120 000 objects", () => {
  const catalog: CatalogObject[] = [];
  for (let index = 0; index < 20_000; index++) {
    catalog.push({
      object_type: "table",
      name: `T${index}`,
      parent: null,
      ddl: `CREATE TABLE "APP"."T${index}" ("ID" NUMBER)`,
      attributes: {},
    });
    catalog.push({
      object_type: "trigger",
      name: `T${index}_TRG`,
      parent: `T${index}`,
      ddl: `CREATE TRIGGER "T${index}_TRG" BEGIN "APP"."P${index % 5_000}".RUN; END;`,
      attributes: {},
    });
  }
  for (let index = 0; index < 40_000; index++)
    catalog.push({
      object_type: index % 2 ? "package_body" : "package",
      name: `P${Math.floor(index / 2)}`,
      parent: null,
      ddl: `CREATE PACKAGE "P${Math.floor(index / 2)}" AS END;`,
      attributes: {},
    });
  for (let index = 0; index < 40_000; index++)
    catalog.push({
      object_type: "function",
      name: `F${index}`,
      parent: null,
      ddl: `CREATE FUNCTION "F${index}" RETURN NUMBER AS BEGIN RETURN 1; END;`,
      attributes: {},
    });
  const picked = Array.from({ length: 2_000 }, (_, index) => `trigger:T${index}.T${index}_TRG`);
  const samples: number[] = [];
  let kept = 0;
  for (let run = 0; run < 9; run++) {
    const started = performance.now();
    kept = selectTables(catalog, undefined, picked).objects.length;
    samples.push(performance.now() - started);
  }
  const { median, p95 } = stats(samples);
  console.log(
    `transfer object selection: ${catalog.length} objects, ${picked.length} picked, median ${median.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms`,
  );
  expect(kept).toBe(20_000 + 2_000 + 2_000 * 2);
  expect(median).toBeLessThan(250);
  expect(p95).toBeLessThan(400);
});
