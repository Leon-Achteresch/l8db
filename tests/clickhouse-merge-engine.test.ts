import { expect, test } from "bun:test";
import { clickhouseMergeContext } from "../src/lib/clickhouse-merge-engine";

test("recognizes ClickHouse engines with row-changing merge rules and their documented replicas", () => {
  for (const [base, rule] of [
    ["ReplacingMergeTree", "Versionen"],
    ["CollapsingMergeTree", "Vorzeichen"],
    ["VersionedCollapsingMergeTree", "gleicher Version"],
    ["SummingMergeTree", "summiert"],
    ["AggregatingMergeTree", "Aggregatzustände"],
  ]) {
    for (const engine of [base, `Replicated${base}`]) {
      const context = clickhouseMergeContext(engine);
      expect(context?.engine).toBe(engine);
      expect(context?.explanation).toContain(rule);
    }
  }
});

test("unknown, plain, or malformed engine metadata has no merge hint", () => {
  for (const engine of [
    null,
    undefined,
    5,
    {},
    "",
    "MergeTree",
    "ReplicatedMergeTree",
    "Distributed",
    "View",
    "SharedReplacingMergeTree",
    "FutureMergeTree",
    "ReplacingMergeTree()",
    " ReplacingMergeTree ",
    "constructor",
    "Replicated",
  ]) {
    expect(clickhouseMergeContext(engine)).toBeUndefined();
  }
});
