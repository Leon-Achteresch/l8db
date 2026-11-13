import { expect, mock, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";
import { definitionHunks } from "../src/lib/definition-merge";

const PACKAGE_LINES = 40_000;
const packageSource = (part: string) =>
  `CREATE OR REPLACE ${part} "APP"."PKG_LAGER" AS\n${Array.from(
    { length: PACKAGE_LINES },
    (_, index) => `  PROCEDURE buchen_${index}(p_id IN NUMBER);`,
  ).join("\n")}\nEND pkg_lager;`;
const packageParts = [packageSource("PACKAGE"), packageSource("PACKAGE BODY")];
let requests = 0;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (_command: string, args: { oid: string }) => {
    requests += 1;
    return packageParts[args.oid.endsWith("BODY") ? 1 : 0];
  },
}));
const { EMPTY_COMPARE_SIDE, loadCompareDefinition, loadPortableDefinition } = await import(
  "../src/lib/compare-definition"
);

test("Worst-Case-Diff großer, völlig verschiedener Entwürfe bleibt im Budget", async () => {
  const source = Array.from({ length: 3_000 }, (_, index) => `  source_column_${index} text`).join(
    "\n",
  );
  const draft = Array.from({ length: 3_000 }, (_, index) => `  draft_column_${index} text`).join(
    "\n",
  );
  const heapBefore = process.memoryUsage().heapUsed;
  const diff = await measureScenario(() => {
    definitionHunks(source, draft);
  });
  const heapAfter = process.memoryUsage().heapUsed;
  await reportScenario("definition-merge-worst-case", {
    lines: 3_000,
    diff,
    heapDeltaBytes: heapAfter - heapBefore,
  });
  expect(definitionHunks(source, draft)).toEqual([
    { sourceStart: 0, sourceEnd: 3_000, draftStart: 0, draftEnd: 3_000 },
  ]);
  expect(diff.p95Ms).toBeLessThan(15);
  expect(heapAfter - heapBefore).toBeLessThan(64 * 1024 * 1024);
});

test("Schemaneutrale Oracle-Packages laden ohne Zusatzabfragen im Budget des Rohtexts", async () => {
  const connection = { id: "ora", kind: "oracle", connectionString: "oracle://u@h/db" } as never;
  const side = {
    ...EMPTY_COMPARE_SIDE,
    connectionId: "ora",
    schema: "APP",
    objectType: "package" as const,
    objectName: "PKG_LAGER",
  };
  const raw = await measureScenario(async () => {
    await loadCompareDefinition(connection, side);
  });
  requests = 0;
  let definition = "";
  const heapBefore = process.memoryUsage().heapUsed;
  const portable = await measureScenario(async () => {
    definition = await loadPortableDefinition(connection, side);
  });
  const heapAfter = process.memoryUsage().heapUsed;
  await reportScenario("compare-portable-oracle-package", {
    lines: PACKAGE_LINES * 2,
    bytes: definition.length,
    raw,
    portable,
    databaseRequestsPerLoad: requests / 11,
    heapDeltaBytes: heapAfter - heapBefore,
  });
  expect(definition).toStartWith(
    'PACKAGE SPEC PKG_LAGER\n\nCREATE OR REPLACE PACKAGE "PKG_LAGER" AS',
  );
  expect(definition).not.toContain('"APP"');
  expect(requests).toBe(22);
  expect(portable.p95Ms).toBeLessThan(raw.p95Ms * 1.5 + 5);
  expect(portable.p95Ms).toBeLessThan(250);
  expect(heapAfter - heapBefore).toBeLessThan(64 * 1024 * 1024);
});
