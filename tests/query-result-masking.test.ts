import { expect, test } from "bun:test";
import { maskQueryResult, resultJsonRows } from "../src/features/query/query-result-masking";
import type { QueryResult } from "../src/lib/db";
import type { ColumnMask } from "../src/lib/masking";

const result = {
  columns: ["id", "email", "note"],
  rows: [
    { id: 1, email: "alice@secret.example", note: "x" },
    { id: 2, email: "bob@secret.example" },
  ],
} as unknown as QueryResult;

const masks: ColumnMask[] = [{ column: "email", mode: "partial" }];

test("masks rows that feed JSON view, search and copy", () => {
  const masked = maskQueryResult(result, masks);
  expect(masked?.columns).toEqual(result.columns);
  expect(masked?.rows.map((row) => row.email)).toEqual([
    "a***@secret.example",
    "b***@secret.example",
  ]);
  expect(result.rows[0].email).toBe("alice@secret.example");
});

test("keeps the raw result when no mask is active", () => {
  expect(maskQueryResult(result, [])).toBe(result);
  expect(maskQueryResult(null, masks)).toBeNull();
});

test("JSON export rows apply active masks and fill missing columns with null", () => {
  const rows = resultJsonRows(result, [{ column: "email", mode: "text", text: "***" }]);
  expect(rows).toEqual([
    { id: 1, email: "***", note: "x" },
    { id: 2, email: "***", note: null },
  ]);
  expect(resultJsonRows(result, [])[0].email).toBe("alice@secret.example");
  expect(resultJsonRows(null, masks)).toEqual([]);
});
