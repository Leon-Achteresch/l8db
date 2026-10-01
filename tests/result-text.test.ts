import { expect, test } from "bun:test";
import { buildStatusText } from "../src/features/query/query-view/result-text";

const result = (rows: number, truncated?: boolean) => ({
  columns: ["a"],
  rows: Array.from({ length: rows }, () => ({ a: 1 })),
  rows_affected: null,
  execution_time_ms: 3,
  truncated,
});

test("only flags results the backend actually cut", () => {
  expect(buildStatusText(result(1000))).toBe("1000 Zeilen · 3 ms");
  expect(buildStatusText(result(1000, true))).toBe("1000 Zeilen · auf 1000 begrenzt · 3 ms");
  expect(buildStatusText(result(2, true))).toBe("2 Zeilen · Werte gekürzt · 3 ms");
});
