import { expect, test } from "bun:test";
import type { QueryResult } from "../src/lib/db";
import {
  compareCellText,
  compareResults,
  detectKeyColumns,
  EMPTY_RESULT_RUNS,
  nextResultRuns,
  RESULT_COMPARE_MAX_CHARS,
  type ResultRun,
  resultCompareLimit,
} from "../src/lib/result-compare";

function result(columns: string[], rows: Record<string, unknown>[]): QueryResult {
  return { columns, rows, rows_affected: rows.length, execution_time_ms: 1 };
}

function run(value: QueryResult, at: number, connectionId = "a", database: string | null = "db") {
  return { result: value, sql: "SELECT 1", at, connectionId, database } satisfies ResultRun;
}

const orders = result(
  ["id", "status", "total"],
  [
    { id: 1, status: "open", total: "10.00" },
    { id: 2, status: "open", total: "20.00" },
    { id: 3, status: "paid", total: "30.00" },
  ],
);

test("jeder Lauf wird zur Basis des nächsten, eine festgehaltene Basis bleibt", () => {
  const first = run(orders, 1);
  const second = run(orders, 2);
  const third = run(orders, 3);
  let runs = nextResultRuns(EMPTY_RESULT_RUNS, first);
  expect(runs).toEqual({ baseline: null, latest: first, pinned: false });
  runs = nextResultRuns(runs, second);
  expect(runs.baseline).toBe(first);
  runs = nextResultRuns({ ...runs, pinned: true }, third);
  expect(runs).toEqual({ baseline: first, latest: third, pinned: true });
});

test("ein Wechsel von Verbindung oder Datenbank verwirft auch eine festgehaltene Basis", () => {
  const pinned = { baseline: run(orders, 1), latest: run(orders, 2), pinned: true };
  expect(nextResultRuns(pinned, run(orders, 3, "b"))).toMatchObject({
    baseline: null,
    pinned: false,
  });
  expect(nextResultRuns(pinned, run(orders, 3, "a", "other")).baseline).toBeNull();
});

test("unvollständige oder zu große Ergebnisse werden nicht als Lauf gehalten", () => {
  const capped = result(
    ["id"],
    Array.from({ length: 1000 }, (_, id) => ({ id })),
  );
  const truncated = { ...orders, truncated: true };
  const huge = result(["blob"], [{ blob: "x".repeat(RESULT_COMPARE_MAX_CHARS + 1) }]);
  for (const value of [capped, truncated, huge]) {
    expect(resultCompareLimit(value)).not.toBeNull();
    const runs = nextResultRuns({ ...EMPTY_RESULT_RUNS, latest: run(orders, 1) }, run(value, 2));
    expect(runs.latest).toBeNull();
    expect(runs.baseline?.at).toBe(1);
  }
  expect(resultCompareLimit(orders)).toBeNull();
});

test("der Schlüssel ist die erste gemeinsame Spalte, die in beiden Läufen eindeutig ist", () => {
  const listing = result(
    ["status", "code", "id"],
    [
      { status: "open", code: null, id: 1 },
      { status: "open", code: "b", id: 2 },
    ],
  );
  expect(detectKeyColumns(listing, listing)).toEqual(["id"]);
  const duplicates = result(["status"], [{ status: "x" }, { status: "x" }]);
  expect(detectKeyColumns(duplicates, duplicates)).toEqual([]);
});

test("Zeilen werden über den Schlüssel als geändert, neu und entfernt erkannt", () => {
  const next = result(
    ["id", "status", "total", "note"],
    [
      { id: 1, status: "open", total: "10.00", note: null },
      { id: 3, status: "shipped", total: "30.00", note: null },
      { id: 4, status: "open", total: "40.00", note: "neu" },
    ],
  );
  const comparison = compareResults(orders, next, ["id"]);
  expect(comparison.error).toBeNull();
  expect(comparison.counts).toEqual({ added: 1, removed: 1, changed: 1, equal: 1 });
  expect(comparison.columns).toEqual({
    shared: ["id", "status", "total"],
    added: ["note"],
    removed: [],
  });
  expect(comparison.changes.map((change) => [change.kind, change.key?.id])).toEqual([
    ["removed", 2],
    ["changed", 3],
    ["added", 4],
  ]);
  const changed = comparison.changes.find((change) => change.kind === "changed");
  expect(changed?.changed).toEqual(["status"]);
  expect(changed?.before?.status).toBe("paid");
  expect(changed?.after?.status).toBe("shipped");
  for (const change of comparison.changes) {
    expect(change.position).toBeGreaterThanOrEqual(0);
    expect(change.position).toBeLessThanOrEqual(1);
  }
});

test("ohne Schlüssel zählt der Vergleich gleiche Zeilen mehrfach", () => {
  const before = result(["v"], [{ v: "a" }, { v: "a" }, { v: "b" }]);
  const after = result(["v"], [{ v: "b" }, { v: "a" }, { v: "c" }]);
  const comparison = compareResults(before, after, []);
  expect(comparison.counts).toEqual({ added: 1, removed: 1, changed: 0, equal: 2 });
  expect(comparison.changes.map((change) => [change.kind, change.row])).toEqual([
    ["removed", 1],
    ["added", 2],
  ]);
  expect(compareResults(before, before, []).changes).toEqual([]);
});

test("ein nicht eindeutiger Schlüssel liefert eine Meldung statt eines falschen Vergleichs", () => {
  const before = result(["status"], [{ status: "open" }, { status: "open" }]);
  const comparison = compareResults(before, before, ["status"]);
  expect(comparison.error).toContain("status");
  expect(comparison.changes).toEqual([]);
  expect(compareResults(orders, result(["other"], [{ other: 1 }]), []).error).toContain(
    "keine gemeinsame Spalte",
  );
});

test("maskierte Spalten zeigen nur maskierte Werte, gemischte nie den echten Wert", () => {
  expect(compareCellText("email", "a@b.de", [{ column: "email", mode: "shuffle" }])).toBe("***");
  expect(compareCellText("email", "a@b.de", [{ column: "email", mode: "text", text: "##" }])).toBe(
    "##",
  );
  expect(compareCellText("email", "a@b.de", [{ column: "email", mode: "hash" }])).not.toContain(
    "a@b.de",
  );
  expect(compareCellText("name", null, [])).toBe("NULL");
  expect(compareCellText("data", { a: 1 }, [])).toBe('{"a":1}');
});
