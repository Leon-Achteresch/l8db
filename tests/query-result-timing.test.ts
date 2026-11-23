import { expect, test } from "bun:test";
import type { QueryResult } from "../src/lib/db";
import {
  type QueryResultTiming,
  queryDurationText,
  queryTimingDescription,
  withAdapterResultTiming,
  withoutMeasuredQueryTiming,
} from "../src/lib/query-result-timing";

const result: QueryResult = {
  columns: ["id"],
  rows: [{ id: 1 }],
  rows_affected: null,
  execution_time_ms: 17,
};

test("only verified direct adapter contracts receive the known scope", () => {
  for (const kind of ["postgres", "mysql"] as const) {
    const tagged = withAdapterResultTiming(result, kind);
    expect(tagged).not.toBe(result);
    expect(tagged.rows).toBe(result.rows);
    expect(tagged.execution_time_ms).toBe(17);
    expect(queryDurationText(tagged)).toBe("17 ms inkl. Ergebnisübernahme");
    expect(queryTimingDescription(tagged)).toContain("Ergebnistransport");
    expect(queryTimingDescription(tagged)).toContain("Darstellung sind nicht enthalten");
  }
  expect(result).not.toHaveProperty("timingScope");
});

test("unknown and old results stay unknown; provider changes cannot label a retained result", () => {
  const measured = withAdapterResultTiming(result, "postgres");
  expect(queryDurationText(JSON.parse(JSON.stringify(measured)))).toBe(
    "17 ms inkl. Ergebnisübernahme",
  );
  for (const kind of ["mssql", "sqlite", "clickhouse", undefined] as const) {
    const unknown = withAdapterResultTiming(measured, kind);
    expect(unknown).not.toHaveProperty("timingScope");
    expect(queryDurationText(unknown)).toBe("17 ms (Messumfang unbekannt)");
  }
  expect(queryDurationText(result)).toContain("unbekannt");
  expect(
    queryDurationText({
      ...result,
      timingScope: "old-unknown-tag",
    } as unknown as QueryResultTiming),
  ).toContain("unbekannt");
  expect(queryDurationText(measured)).toContain("inkl. Ergebnisübernahme");
});

test("zero measured time and a locally unmeasured placeholder mean different things", () => {
  const zero = { ...result, execution_time_ms: 0 };
  expect(queryDurationText(withAdapterResultTiming(zero, "postgres"))).toBe(
    "0 ms inkl. Ergebnisübernahme",
  );
  const local = withoutMeasuredQueryTiming(zero);
  expect(local.execution_time_ms).toBe(0);
  expect(queryDurationText(local)).toBe("Nicht gemessen");
  expect(queryTimingDescription(local)).toContain("Platzhalter");
});
