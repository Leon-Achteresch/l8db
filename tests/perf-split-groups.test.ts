import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { measureScenario, reportScenario } from "../scripts/performance-report";

const invocations: string[] = [];
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    invocations.push(command);
    return null;
  },
}));

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    addEventListener() {},
    removeEventListener() {},
  },
  configurable: true,
});

const { useConnectionsStore } = await import("../src/lib/connections");
const { tabKey, useTableTabs } = await import("../src/lib/table-tabs");
const {
  MAX_SPLIT_GROUPS,
  foreignSplitGroups,
  hiddenTabLists,
  openDetached,
  parkedViews,
  standaloneTabs,
  useSplitView,
} = await import("../src/lib/split-view");
const { resolveDrop } = await import("../src/lib/tab-drop");
const { focusedConnectionId, paneConnectionId } = await import("../src/lib/split-view");
const { connectionEnvironment } = await import("../src/lib/environments");
const { tabHasTransaction, transactionsClosedWith } = await import("../src/lib/tab-transactions");
const { useTransactionStore } = await import("../src/lib/transactions");
const { TabStatusMarkers } = await import("../src/features/shell/table-tabs/tab-status-markers");

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
  const origin = useSplitView.getState().activeGroup ?? "";
  let fresh = 0;
  const freshSplit = await measureScenario(() => {
    for (let index = 0; index < 20; index++) {
      const key = backgroundKeys[fresh++ % 10];
      useSplitView.getState().reveal(key);
      useSplitView.getState().split({ activeKey: key });
      useSplitView.getState().openGroup(origin);
    }
  });
  const freshGroups = useSplitView.getState().groups[connection.id];
  const freshViews = freshGroups.filter((group) => group.tabs[1] === null).length;
  const parkedCount = parkedViews(useSplitView.getState()).length;
  const openCount = useSplitView.getState().openGroups[connection.id]?.length ?? 0;
  const parkedList = await measureScenario(() => {
    for (let index = 0; index < 100; index++)
      standaloneTabs(useTableTabs.getState().tabs, hiddenTabLists(useSplitView.getState()));
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
    freshSplit,
    freshViews,
    openViews: openCount,
    parkedViews: parkedCount,
    parkedList,
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
  expect(freshSplit.p95Ms / 20).toBeLessThan(3);
  expect(freshViews).toBe(10);
  expect(openCount).toBeLessThanOrEqual(MAX_SPLIT_GROUPS);
  expect(parkedCount).toBe(openCount - 1);
  expect(parkedList.p95Ms / 100).toBeLessThan(1);
  expect(freshGroups).toHaveLength(MAX_SPLIT_GROUPS);
  expect(useSplitView.getState().activeGroup).toBe(origin);
  expect(drop.p95Ms / 1_000).toBeLessThan(0.05);
  expect(bytes).toBeLessThan(50 * 4 * 512);
});

test("tab environment and transaction markers stay cheap with 200 tabs over 20 connections", async () => {
  const environments = ["development", "test", "staging", "production"] as const;
  const connections = Array.from({ length: 20 }, (_, index) => ({
    id: `env${index}`,
    name: `Umgebung ${index}`,
    kind: "postgres" as const,
    sslMode: "prefer" as const,
    connectionString: `postgresql://app@db-${index % 2 ? "prod" : "dev"}-${index}.example.com/db`,
    environment: index % 2 ? undefined : environments[(index / 2) % 4],
  }));
  const hostGroupRules = [
    { id: "prod", name: "Prod", pattern: "db-prod-*", environment: "production" as const },
  ];
  useConnectionsStore.setState({ connections, hostGroupRules, activeId: "env0" });
  invocations.length = 0;
  const local = Array.from({ length: 180 }, (_, index) =>
    index % 2
      ? { kind: "query" as const, id: `env-q${index}`, title: `Q${index}`, sql: "SELECT 1" }
      : { kind: "table" as const, schema: "public", table: `t${index}` },
  );
  const remote = Array.from({ length: 20 }, (_, index) => ({
    kind: "table" as const,
    schema: "public",
    table: `t${index * 2}`,
    connectionId: `env${index}`,
  }));
  useTableTabs.setState({ tabs: local, tabsByConnection: {} });
  const remoteKeys = remote.map(tabKey);
  const paneTabs = [
    local.slice(0, 60).map(tabKey),
    remoteKeys.slice(0, 10),
    remoteKeys.slice(10),
    local.slice(60, 80).map(tabKey),
  ];
  useSplitView.setState({
    panes: paneTabs.map((keys) => keys[0]),
    paneTabs,
    away: false,
    focusedPane: 0,
    paneConnections: {},
  });
  useTransactionStore.setState({
    transactions: Array.from({ length: 20 }, (_, index) => ({
      txId: `tx${index}`,
      connectionId: `env${index}`,
      connectionName: `Umgebung ${index}`,
      scope:
        index % 2
          ? ({ type: "query" } as const)
          : ({ type: "table", schema: "public", table: `t${index * 2}` } as const),
      changes: [],
      startedAt: 0,
    })),
  });
  const all = [...local, ...remote];
  let markers = 0;
  const render = await measureScenario(() => {
    const { activeId } = useConnectionsStore.getState();
    const split = useSplitView.getState();
    const { transactions } = useTransactionStore.getState();
    const byConnection = new Map(
      connections.map((entry) => [entry.id, connectionEnvironment(entry, hostGroupRules)]),
    );
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        all.map((tab) => {
          const key = tabKey(tab);
          const connectionId = paneConnectionId(split, key, activeId, connections) ?? activeId;
          return createElement(TabStatusMarkers, {
            key,
            environment: connectionId ? (byConnection.get(connectionId) ?? null) : null,
            transaction: tabHasTransaction(tab, connectionId, transactions),
            isActive: false,
          });
        }),
      ),
    );
    markers = (html.match(/data-environment=/g) ?? []).length;
  });
  let notifications = 0;
  const stopConnections = useConnectionsStore.subscribe(() => notifications++);
  const stopTransactions = useTransactionStore.subscribe(() => notifications++);
  const focused = new Set<string | null>();
  let pane = 0;
  const focus = await measureScenario(() => {
    for (let index = 0; index < 100; index++) {
      useSplitView.getState().focusPane(pane++ % 4);
      const { activeId } = useConnectionsStore.getState();
      focused.add(
        focusedConnectionId(useSplitView.getState(), paneTabs[0][0], activeId, connections),
      );
    }
  });
  stopConnections();
  stopTransactions();
  let held = 0;
  const closeAll = await measureScenario(() => {
    held = transactionsClosedWith(all.map(tabKey)).length;
  });

  await reportScenario("split-tab-environment-markers", {
    tabs: all.length,
    connections: connections.length,
    transactions: 20,
    markers,
    render,
    focus,
    closeAll,
    held,
    notifications,
    requests: invocations.length,
  });
  expect(markers).toBe(all.length);
  expect([...focused].sort()).toEqual(["env0", "env10"]);
  expect(notifications).toBe(0);
  expect(invocations).toEqual([]);
  expect(held).toBe(10);
  expect(render.p95Ms).toBeLessThan(40);
  expect(focus.p95Ms / 100).toBeLessThan(0.5);
  expect(closeAll.p95Ms).toBeLessThan(20);
});
