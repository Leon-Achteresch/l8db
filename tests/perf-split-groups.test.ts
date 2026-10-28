import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  },
  configurable: true,
});

const { useConnectionsStore } = await import("../src/lib/connections");
const { tabKey, useTableTabs } = await import("../src/lib/table-tabs");
const { MAX_SPLIT_GROUPS, useSplitView } = await import("../src/lib/split-view");

test("saved split views stay cheap with many tabs and groups", async () => {
  const connection = useConnectionsStore.getState().addConnection({
    name: "perf",
    kind: "postgres",
    connectionString: "postgresql://localhost:5432/db",
    sslMode: "prefer",
  });
  useConnectionsStore.getState().setActiveId(connection.id);
  const tabs = Array.from({ length: 1_000 }, (_, index) => ({
    kind: "query" as const,
    id: `q${index}`,
    title: `Query ${index}`,
    sql: "SELECT 1",
  }));
  useTableTabs.setState({ tabs, tabsByConnection: {} });
  for (let group = 0; group < 60; group++) {
    useSplitView.getState().collapse();
    useSplitView.getState().addPane(tabKey(tabs[group * 4]), tabKey(tabs[group * 4 + 1]));
    useSplitView.getState().addPane(null, tabKey(tabs[group * 4 + 2]));
    useSplitView.getState().addPane(null, tabKey(tabs[group * 4 + 3]));
  }
  const groups = useSplitView.getState().groups[connection.id];

  let pane = 0;
  const focus = await measureScenario(() => {
    for (let index = 0; index < 100; index++) useSplitView.getState().focusPane(pane++ % 4);
  });
  let typed = 0;
  const typing = await measureScenario(() => {
    for (let index = 0; index < 100; index++)
      useTableTabs.getState().updateQuerySql("q0", `SELECT ${typed++}`);
  });
  let opened = 0;
  const open = await measureScenario(() => {
    for (let index = 0; index < 20; index++)
      useSplitView.getState().openGroup(groups[opened++ % groups.length].id);
  });
  const bytes = storage.get("l8db.split-view")?.length ?? 0;

  await reportScenario("split-saved-views", {
    tabs: tabs.length,
    groups: groups.length,
    panesPerGroup: 4,
    focus,
    typing,
    open,
    bytes,
  });
  expect(groups).toHaveLength(MAX_SPLIT_GROUPS);
  expect(groups[0].name).toBe("Ansicht 11");
  expect(focus.p95Ms / 100).toBeLessThan(1);
  expect(typing.p95Ms / 100).toBeLessThan(1);
  expect(open.p95Ms / 20).toBeLessThan(2);
  expect(bytes).toBeLessThan(50 * 4 * 512);
});
