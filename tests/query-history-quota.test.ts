import { describe, expect, test } from "bun:test";
import { type QueryHistoryEntry, retainHistory } from "../src/lib/query-history";

function entry(id: number, sqlLength: number): QueryHistoryEntry {
  return {
    id: String(id),
    connectionId: "c",
    database: null,
    sql: "x".repeat(sqlLength),
    ranAt: id,
    durationMs: null,
    rowCount: null,
    error: null,
  };
}

describe("retainHistory", () => {
  test("drops oldest entries once the total sql budget is exceeded", () => {
    const entries = [entry(1, 400), entry(2, 400), entry(3, 400)];
    const kept = retainHistory(entries, 500, 900);
    expect(kept.map((e) => e.id)).toEqual(["3", "2"]);
  });

  test("skips only entries that exceed the budget and keeps older small ones", () => {
    const small = [1, 2, 3].map((id) => ({ ...entry(id, 10), connectionId: "a" }));
    const kept = retainHistory([...small, entry(4, 800), entry(5, 800)], 500, 900);
    expect(kept.map((e) => e.id)).toEqual(["5", "3", "2", "1"]);
  });

  test("still enforces the per-connection limit", () => {
    const kept = retainHistory([entry(1, 1), entry(2, 1), entry(3, 1)], 2);
    expect(kept).toHaveLength(2);
  });
});
