import { expect, test } from "bun:test";
import { buildStatusText, withCreateNotice } from "../src/features/query/query-view/result-text";
import { withAdapterResultTiming } from "../src/lib/query-result-timing";

const result = (rows: number, truncated?: boolean) => ({
  columns: ["a"],
  rows: Array.from({ length: rows }, () => ({ a: 1 })),
  rows_affected: null,
  execution_time_ms: 3,
  truncated,
});

test("only flags results the backend actually cut", () => {
  expect(buildStatusText(result(1000))).toBe("1000 Zeilen · 3 ms (Messumfang unbekannt)");
  expect(buildStatusText(result(1000, true))).toBe(
    "1000 Zeilen · auf 1000 begrenzt · 3 ms (Messumfang unbekannt)",
  );
  expect(buildStatusText(result(2, true))).toBe(
    "2 Zeilen · Werte gekürzt · 3 ms (Messumfang unbekannt)",
  );
});

test("verified adapter duration preserves counts, truncation and notices", () => {
  const measured = withAdapterResultTiming(result(2, true), "postgres");
  expect(buildStatusText(measured)).toBe("2 Zeilen · Werte gekürzt · 3 ms inkl. Ergebnisübernahme");
  const notice = withCreateNotice(
    withAdapterResultTiming({ ...result(0), columns: [], rows_affected: 1 }, "mysql"),
    "CREATE VIEW sample AS SELECT 1 AS id",
  );
  expect(notice?.notice).toBeTruthy();
  expect(buildStatusText(notice)).toEndWith("3 ms inkl. Ergebnisübernahme");
});
