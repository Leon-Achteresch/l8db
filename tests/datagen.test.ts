import { expect, test } from "bun:test";
import {
  datagenIssues,
  defaultGenerator,
  GENERATOR_KINDS,
  GENERATOR_LABELS,
} from "../src/lib/datagen";
import type { DatagenColumn, DatagenRequest } from "../src/lib/db";

const column = (over: Partial<DatagenColumn>): DatagenColumn => ({
  name: "c",
  dataType: "text",
  nullable: true,
  generator: { kind: "lorem", min: 1, max: 5 },
  nullRatio: 0,
  enumValues: [],
  ...over,
});

const request = (columns: DatagenColumn[], over: Partial<DatagenRequest> = {}): DatagenRequest => ({
  schema: "public",
  table: "t",
  rows: 10,
  batchSize: 100,
  seed: 1,
  locale: "de",
  transaction: true,
  columns,
  unique: [],
  ...over,
});

test("jeder Generator hat ein deutsches Label", () => {
  for (const kind of GENERATOR_KINDS) expect(GENERATOR_LABELS[kind].length).toBeGreaterThan(0);
});

test("Standardparameter respektieren Längen und Enum-Werte", () => {
  expect(defaultGenerator("lorem", column({ maxLength: 3 }))).toEqual({
    kind: "lorem",
    min: 3,
    max: 3,
  });
  expect(defaultGenerator("list", column({ enumValues: ["x", "y"] }))).toEqual({
    kind: "list",
    values: ["x", "y"],
  });
  expect(defaultGenerator("email", column({}))).toEqual({ kind: "email" });
});

test("Plausibilitätsprüfung vor dem Lauf", () => {
  expect(datagenIssues(request([column({})]))).toEqual([]);
  expect(datagenIssues(request([column({ generator: { kind: "skip" } })]))).toContain(
    "Mindestens eine Spalte befüllen.",
  );
  expect(datagenIssues(request([column({ nullable: false, nullRatio: 0.2 })]))).toHaveLength(1);
  expect(datagenIssues(request([column({})], { rows: 0 }))).toContain(
    "Zeilenzahl muss mindestens 1 sein.",
  );
  expect(
    datagenIssues(
      request([column({ nullable: false, generator: { kind: "null" } })], {
        source: { schema: "public", table: "s", masks: [] },
      }),
    ),
  ).toEqual([]);
});
