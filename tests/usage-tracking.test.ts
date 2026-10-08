import { expect, test } from "bun:test";
import { createUsageTracker, USAGE_IDLE_MS } from "../src/lib/usage-tracking";

function fixture() {
  let time = 0;
  let enabled = true;
  const opens: [string, string | null][] = [];
  const active: [string, number][] = [];
  const tracker = createUsageTracker({
    now: () => time,
    enabled: () => enabled,
    open: (view, previous) => opens.push([view, previous]),
    active: (view, ms) => active.push([view, ms]),
  });
  return {
    tracker,
    opens,
    active,
    advance: (ms: number) => {
      time += ms;
    },
    enable: (value: boolean) => {
      enabled = value;
      tracker.reset();
    },
  };
}

test("tracks static areas and adjacent paths without inflating same-area resolutions", () => {
  const f = fixture();
  f.tracker.view("/_app/_workspace/tables/$schema/$table");
  f.advance(2000);
  f.tracker.view("/tables/private/customer");
  f.tracker.view("/query/$id");
  f.advance(1000);
  f.tracker.view("/settings/statistics");
  expect(f.opens).toEqual([
    ["/tables", null],
    ["/query", "tables"],
    ["/settings/statistics", "query"],
  ]);
  expect(f.active).toEqual([
    ["tables", 2000],
    ["query", 1000],
  ]);
  f.tracker.dispose();
});

test("caps idle time, excludes unfocused time and restarts after interaction", () => {
  const f = fixture();
  f.tracker.view("/query");
  f.advance(USAGE_IDLE_MS * 20);
  expect(f.active).toEqual([]);
  f.tracker.activity();
  expect(f.active).toEqual([["query", USAGE_IDLE_MS]]);
  f.advance(1000);
  f.tracker.suspend();
  f.advance(USAGE_IDLE_MS * 20);
  f.tracker.activity();
  f.tracker.resume();
  f.advance(2000);
  f.tracker.dispose();
  expect(f.active).toEqual([
    ["query", USAGE_IDLE_MS],
    ["query", 1000],
    ["query", 2000],
  ]);
  expect(f.opens).toHaveLength(1);
  f.advance(1000);
  f.tracker.activity();
  f.tracker.view("/tables");
  expect(f.opens).toHaveLength(1);
});

test("collection starts at consent and never backfills earlier interaction", () => {
  const f = fixture();
  f.enable(false);
  f.tracker.view("/query");
  f.advance(10000);
  f.tracker.activity();
  expect(f.opens).toEqual([]);
  f.enable(true);
  f.advance(2000);
  f.tracker.suspend();
  expect(f.opens).toEqual([["/query", null]]);
  expect(f.active).toEqual([["query", 2000]]);
  f.enable(false);
  f.tracker.dispose();
  expect(f.active).toHaveLength(1);
});

test("resetting local statistics discards active time from before the reset", () => {
  const f = fixture();
  f.tracker.view("/query");
  f.advance(30000);
  f.tracker.resetActivity();
  f.advance(1000);
  f.tracker.suspend();
  expect(f.active).toEqual([["query", 1000]]);
  expect(f.opens).toHaveLength(1);
  f.tracker.dispose();
});
