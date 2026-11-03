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
  const names = Array.from({ length: 50_000 }, (_, index) => `TABELLE_${index}`);
  const chosen = new Set(names.slice(0, 25_000));
  const samples: number[] = [];
  let markup = "";
  for (let run = 0; run < 15; run++) {
    const started = performance.now();
    markup = renderToStaticMarkup(
      createElement(TransferTableList, { schema: "APP", names, chosen, onToggle: () => {} }),
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
