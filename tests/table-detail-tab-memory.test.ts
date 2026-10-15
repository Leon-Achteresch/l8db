import { beforeEach, expect, test } from "bun:test";
import type { Capabilities } from "../src/lib/db";
import { availableTableDetailTabs, resolveTableDetailTab } from "../src/lib/table-detail-tabs";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
  },
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage: globalThis.localStorage },
});
const { detailTabFor, tableViewStateKey, useTableViewStateStore } = await import(
  "../src/lib/table-view-state"
);

const caps = { object_grants: true, used_by: true, object_admin: true } as Capabilities;
const viewTabs = availableTableDetailTabs(true, caps);
const tableTabs = availableTableDetailTabs(false, caps);

function key(table: string) {
  return tableViewStateKey("conn", "db", "public", table) ?? "";
}

function shownTab(table: string, visible: { id: string }[]) {
  useTableViewStateStore.getState().keepDetailTab(key(table));
  return resolveTableDetailTab(
    detailTabFor(useTableViewStateStore.getState(), key(table)),
    visible as never,
  );
}

beforeEach(() => {
  useTableViewStateStore.setState({ views: {}, lastDetailTab: "data" });
});

test("neue Views öffnen im zuletzt gewählten Reiter, bekannte behalten ihren eigenen", () => {
  useTableViewStateStore.getState().selectDetailTab(key("v_a"), "definition");
  expect(shownTab("v_b", viewTabs)).toBe("definition");
  useTableViewStateStore.getState().selectDetailTab(key("v_b"), "columns");
  expect(shownTab("v_a", viewTabs)).toBe("definition");
  expect(shownTab("v_c", viewTabs)).toBe("columns");
  expect(shownTab("t_a", tableTabs)).toBe("columns");
});

test("nicht verfügbare Reiter fallen auf Daten zurück, ohne den Merker zu überschreiben", () => {
  useTableViewStateStore.getState().selectDetailTab(key("v_a"), "definition");
  expect(shownTab("t_a", tableTabs)).toBe("data");
  expect(useTableViewStateStore.getState().lastDetailTab).toBe("definition");
  expect(shownTab("v_b", viewTabs)).toBe("definition");
});

test("bereits offene Objekte folgen nicht der Reiterwahl in anderen Objekten", () => {
  expect(shownTab("t_open", tableTabs)).toBe("data");
  useTableViewStateStore.getState().selectDetailTab(key("v_b"), "columns");
  expect(shownTab("t_open", tableTabs)).toBe("data");
  expect(shownTab("t_new", tableTabs)).toBe("columns");
});

test("der zuletzt gewählte Reiter wird gespeichert", async () => {
  useTableViewStateStore.getState().selectDetailTab(key("v_a"), "used-by");
  await new Promise((resolve) => setTimeout(resolve, 600));
  const persisted = JSON.parse(storage.get("l8db.table-view-state") ?? "null");
  expect(persisted.state.lastDetailTab).toBe("used-by");
  expect(persisted.state.views[key("v_a")].detailTab).toBe("used-by");
});

test("Reiterwechsel über viele Objekte bleibt schnell und begrenzt", () => {
  const tabs = ["data", "columns", "definition", "grants", "used-by"] as const;
  const timings: number[] = [];
  let notifications = 0;
  const unsubscribe = useTableViewStateStore.subscribe(() => {
    notifications += 1;
  });
  for (let i = 0; i < 5_000; i += 1) {
    const started = performance.now();
    useTableViewStateStore.getState().selectDetailTab(key(`v_${i}`), tabs[i % tabs.length]);
    timings.push(performance.now() - started);
  }
  useTableViewStateStore.getState().keepDetailTab(key("v_4999"));
  unsubscribe();
  timings.sort((a, b) => a - b);
  const median = timings[Math.floor(timings.length / 2)];
  const p95 = timings[Math.floor(timings.length * 0.95)];
  console.log(
    `selectDetailTab 5000 Objekte: median ${median.toFixed(4)} ms, p95 ${p95.toFixed(4)} ms`,
  );
  expect(median).toBeLessThan(1);
  expect(p95).toBeLessThan(3);
  expect(Object.keys(useTableViewStateStore.getState().views).length).toBe(100);
  expect(notifications).toBe(5_000);
});
