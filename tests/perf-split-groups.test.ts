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
const { MAX_SPLIT_GROUPS, foreignSplitGroups, openDetached, standaloneTabs, useSplitView } =
  await import("../src/lib/split-view");
const { resolveDrop } = await import("../src/lib/tab-drop");

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
    const keys = [0, 1, 2, 3].map((offset) => tabKey(tabs[group * 4 + offset]));
    useSplitView.getState().collapse();
    for (let pane = 0; pane < 3; pane++)
      useSplitView
        .getState()
        .split({ activeKey: keys[pane], key: keys[pane + 1], target: pane, edge: "right" });
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
  let moved = 0;
  const move = await measureScenario(() => {
    for (let index = 0; index < 100; index++) {
      const key = tabKey(tabs[400 + (moved++ % 100)]);
      useSplitView.getState().moveTab(key, 1 + (index % 3), 0);
    }
  });
  let reordered = 0;
  const reorder = await measureScenario(() => {
    for (let index = 0; index < 100; index++) {
      const state = useSplitView.getState();
      const list = state.paneTabs[0];
      state.moveTab(list[reordered++ % list.length], 0, (reordered * 7) % list.length);
    }
  });
  const cycle = await measureScenario(() => {
    for (let index = 0; index < 20; index++) {
      const state = useSplitView.getState();
      const key = state.panes[3];
      state.closePane(3);
      if (key) useSplitView.getState().split({ activeKey: null, key, target: 2, edge: "bottom" });
    }
  });
  const tableTab = (index: number) => ({
    kind: "table" as const,
    schema: "public",
    table: `t${index}`,
    entityType: "table" as const,
  });
  useSplitView.getState().reveal(useSplitView.getState().panes[0] ?? "");
  let background = 0;
  const backgroundOpen = await measureScenario(() => {
    for (let index = 0; index < 100; index++)
      openDetached(() =>
        useTableTabs.getState().openTab({ schema: "public", table: `t${background++}` }),
      );
  });
  const backgroundKeys = Array.from({ length: background }, (_, index) => tabKey(tableTab(index)));
  const inPanes = new Set(useSplitView.getState().paneTabs.flat());
  const backgroundInPanes = backgroundKeys.filter((key) => inPanes.has(key)).length;
  const masterList = await measureScenario(() => {
    for (let index = 0; index < 100; index++)
      standaloneTabs(useTableTabs.getState().tabs, useSplitView.getState().paneTabs);
  });
  let revealed = 0;
  const switchView = await measureScenario(() => {
    for (let index = 0; index < 100; index++) {
      const state = useSplitView.getState();
      state.reveal(revealed++ % 2 ? backgroundKeys[index] : (state.panes[0] ?? ""));
    }
  });
  let detached = 0;
  const detach = await measureScenario(() => {
    for (let index = 0; index < 100; index++) {
      const key = backgroundKeys[detached++ % backgroundKeys.length];
      useSplitView.getState().moveTab(key, index % 3);
      useSplitView.getState().detach(key, backgroundKeys[(index * 7) % backgroundKeys.length]);
    }
  });
  const stripTabs = Array.from({ length: 60 }, (_, index) => ({
    left: index * 100,
    right: index * 100 + 96,
  }));
  const paneTabs = useSplitView.getState().paneTabs;
  const drop = await measureScenario(() => {
    for (let index = 0; index < 1_000; index++)
      resolveDrop(
        { type: "tab", key: tabKey(tabs[index]) },
        index % 3 === 0
          ? { type: "strip", pane: 1, left: 0, tabs: stripTabs }
          : index % 3 === 1
            ? { type: "strip", pane: "master", left: 0, tabs: stripTabs }
            : { type: "pane", pane: 2, rect: { left: 0, top: 0, width: 800, height: 600 } },
        { x: index % 800, y: index % 600 },
        { paneTabs, single: [], active: null },
      );
  });
  const allGroups = Object.fromEntries(
    Array.from({ length: 20 }, (_, index) => [
      `c${index}`,
      groups.map((group, position) => (position % 2 ? group : { ...group, shared: true })),
    ]),
  );
  const foreignConnections = Array.from({ length: 20 }, (_, index) => ({
    id: `c${index}`,
    name: `Verbindung ${index}`,
  }));
  let foreignCount = 0;
  const foreign = await measureScenario(() => {
    for (let index = 0; index < 100; index++)
      foreignCount = foreignSplitGroups(allGroups, `c${index % 20}`, foreignConnections).length;
  });
  const bytes = storage.get("l8db.split-view")?.length ?? 0;

  await reportScenario("split-saved-views", {
    tabs: tabs.length,
    groups: groups.length,
    panesPerGroup: 4,
    focus,
    typing,
    open,
    move,
    reorder,
    cycle,
    backgroundOpen,
    masterList,
    switchView,
    detach,
    drop,
    foreign,
    foreignGroups: foreignCount,
    bytes,
  });
  expect(foreignCount).toBe((19 * MAX_SPLIT_GROUPS) / 2);
  expect(foreign.p95Ms / 100).toBeLessThan(0.5);
  expect(groups).toHaveLength(MAX_SPLIT_GROUPS);
  expect(groups[0].name).toBe("Ansicht 11");
  expect(focus.p95Ms / 100).toBeLessThan(1);
  expect(typing.p95Ms / 100).toBeLessThan(1);
  expect(open.p95Ms / 20).toBeLessThan(2);
  expect(useSplitView.getState().panes).toHaveLength(4);
  expect(move.p95Ms / 100).toBeLessThan(1);
  expect(reorder.p95Ms / 100).toBeLessThan(1);
  expect(cycle.p95Ms / 20).toBeLessThan(2);
  expect(backgroundInPanes).toBe(0);
  expect(backgroundOpen.p95Ms / 100).toBeLessThan(1);
  expect(masterList.p95Ms / 100).toBeLessThan(0.5);
  expect(switchView.p95Ms / 100).toBeLessThan(1);
  expect(detach.p95Ms / 100).toBeLessThan(2);
  expect(
    useSplitView
      .getState()
      .paneTabs.flat()
      .filter((key) => backgroundKeys.includes(key)),
  ).toEqual([]);
  expect(drop.p95Ms / 1_000).toBeLessThan(0.05);
  expect(bytes).toBeLessThan(50 * 4 * 512);
});
