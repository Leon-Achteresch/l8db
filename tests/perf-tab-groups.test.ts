import { expect, mock, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";

const invocations: string[] = [];
let respond: (command: string, args?: Record<string, unknown>) => unknown = () => null;
mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args?: Record<string, unknown>) => {
    invocations.push(command);
    return respond(command, args);
  },
}));
mock.module("@/router", () => ({
  router: { navigate: async () => undefined, preloadRoute: async () => undefined },
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
const { MAX_SPLIT_GROUPS, foreignSplitGroups, groupPaneTabs, useSplitView } = await import(
  "../src/lib/split-view"
);
type Tab = import("../src/lib/table-tabs").Tab;

test("tab groups with hundreds of tabs save, reopen and cross connections cheaply", async () => {
  const connections = Array.from({ length: 21 }, (_, index) =>
    useConnectionsStore.getState().addConnection({
      name: `Verbindung ${index}`,
      kind: "postgres",
      connectionString: `postgresql://db-${index}.example.com:5432/app`,
      sslMode: "prefer",
    }),
  );
  const [home, target] = connections;
  useConnectionsStore.getState().setActiveId(home.id);
  const sql = `SELECT ${"column_name, ".repeat(150)}1 FROM orders`;
  const tabs: Tab[] = Array.from({ length: 600 }, (_, index) =>
    index % 3 === 2
      ? { kind: "query", id: `q${index}`, title: `Abfrage ${index}`, sql }
      : { kind: "table", schema: "public", table: `t${index}`, entityType: "table" },
  );
  const keys = tabs.map(tabKey);
  useTableTabs.setState({ tabs, tabsByConnection: { [home.id]: tabs } });

  const split = useSplitView.getState();
  split.split({ activeKey: keys[0], key: keys[1], edge: "right" });
  split.split({ activeKey: keys[0], key: keys[2], target: 1, edge: "right" });
  split.split({ activeKey: keys[0], key: keys[3], target: 2, edge: "right" });
  for (let index = 4; index < 400; index++) useSplitView.getState().moveTab(keys[index], index % 4);
  const wide = useSplitView.getState().activeGroup ?? "";
  useSplitView.getState().renameGroup(wide, "Breit");
  useSplitView.getState().setGroupShared(wide, true);
  const wideTabs = () =>
    groupPaneTabs(
      useSplitView.getState().groups[home.id].find((group) => group.id === wide) ?? { tabs: [] },
    ).flat().length;
  const persistedWide = wideTabs();

  let pane = 0;
  const follow = await measureScenario(() => {
    for (let index = 0; index < 100; index++) useSplitView.getState().focusPane(pane++ % 4);
  });
  let moved = 0;
  const move = await measureScenario(() => {
    for (let index = 0; index < 100; index++)
      useSplitView.getState().moveTab(keys[4 + (moved++ % 396)], moved % 4, 0);
  });

  const set = useSplitView.getState().saveTabs(keys[400]) ?? "";
  const setTabs = groupPaneTabs(
    useSplitView.getState().groups[home.id].find((group) => group.id === set) ?? { tabs: [] },
  ).flat().length;
  const save = await measureScenario(() => {
    for (let index = 0; index < 20; index++)
      useSplitView.getState().saveTabs(keys[400 + index], set);
  });

  for (let index = 0; index < MAX_SPLIT_GROUPS - 2; index++) {
    const state = useSplitView.getState();
    state.collapse();
    state.split({ activeKey: keys[index * 2], key: keys[index * 2 + 1], edge: "right" });
    const id = useSplitView.getState().activeGroup ?? "";
    for (let extra = 0; extra < 20; extra++)
      useSplitView.getState().moveTab(keys[100 + index + extra], extra % 2);
    useSplitView.getState().renameGroup(id, `Fest ${index}`);
  }
  const groupCount = useSplitView.getState().groups[home.id].length;

  let opened = 0;
  const open = await measureScenario(() => {
    for (let index = 0; index < 20; index++) {
      const list = useSplitView.getState().groups[home.id];
      useSplitView.getState().openGroup(opened++ % 2 ? wide : list[list.length - 1].id);
    }
  });

  useSplitView.getState().collapse();
  const reopen = await measureScenario(() => {
    useTableTabs.getState().closeAllTabs();
    useSplitView.getState().openGroup(wide);
    useSplitView.getState().openGroup(set);
    useSplitView.getState().collapse();
  });
  const reopened = useTableTabs.getState().tabs.length;
  const reopenedSql = useTableTabs
    .getState()
    .tabs.filter((tab) => tab.kind === "query" && tab.sql === sql).length;

  let closed = 0;
  const close = await measureScenario(() => {
    for (let index = 0; index < 50; index++) {
      const key = keys[closed++ % 400];
      useTableTabs.getState().closeTab(key);
    }
    useSplitView.getState().openGroup(wide);
    useSplitView.getState().collapse();
  });

  useConnectionsStore.getState().setActiveId(target.id);
  const adopt = await measureScenario(() => {
    const state = useSplitView.getState();
    const copy = state.adoptGroup(wide, home.id) ?? "";
    state.openGroup(copy);
    useSplitView.getState().deleteGroup(copy);
    useTableTabs.getState().closeAllTabs();
  });
  const copy = useSplitView.getState().adoptGroup(wide, home.id) ?? "";
  const adopted = groupPaneTabs(useSplitView.getState().groups[target.id][0]).flat();
  const adoptedSql = Object.values(useSplitView.getState().closedTabs[target.id]).filter(
    (tab) => tab.kind === "query" && tab.sql === sql,
  ).length;

  const shared = useSplitView.getState().groups[home.id];
  const allGroups = {
    ...Object.fromEntries(
      connections
        .slice(2)
        .map((connection) => [connection.id, shared.map((group) => ({ ...group, shared: true }))]),
    ),
    [target.id]: useSplitView.getState().groups[target.id],
    [home.id]: shared,
  };
  let foreignCount = 0;
  const foreign = await measureScenario(() => {
    for (let index = 0; index < 100; index++)
      foreignCount = foreignSplitGroups(allGroups, target.id, connections).length;
  });

  let notifications = 0;
  const stop = useSplitView.subscribe(() => notifications++);
  const idle = await measureScenario(() => {
    for (let index = 0; index < 100; index++) {
      useSplitView.getState().adoptGroup(wide, home.id);
      useSplitView.getState().adoptGroup("unbekannt", home.id);
      useSplitView.getState().saveTabs(null, "unbekannt");
    }
  });
  stop();
  const bytes = storage.get("l8db.split-view")?.length ?? 0;
  useConnectionsStore.getState().setActiveId(home.id);
  useTableTabs.getState().closeAllTabs();
  const closedCopies = Object.keys(useSplitView.getState().closedTabs[home.id]).length;
  const closedBytes = storage.get("l8db.split-view")?.length ?? 0;
  useSplitView.getState().openGroup(wide);
  useSplitView.getState().openGroup(set);
  const openCopies = Object.keys(useSplitView.getState().closedTabs[home.id]).length;

  await reportScenario("tab-groups", {
    tabs: tabs.length,
    groups: groupCount,
    connections: connections.length,
    persistedWide,
    setTabs,
    sqlChars: sql.length,
    follow,
    move,
    save,
    open,
    reopen,
    reopened,
    close,
    adopt,
    adoptedTabs: adopted.length,
    foreign,
    foreignGroups: foreignCount,
    idle,
    notifications,
    requests: invocations,
    bytes,
    closedCopies,
    closedBytes,
  });
  expect(persistedWide).toBe(400);
  expect(setTabs).toBe(200);
  expect(groupCount).toBe(MAX_SPLIT_GROUPS);
  expect(reopened).toBe(600);
  expect(reopenedSql).toBe(200);
  expect(adopted).toHaveLength(400);
  expect(adoptedSql).toBe(adopted.filter((tab) => tab.kind === "query").length);
  expect(copy).not.toBe("");
  expect(foreignCount).toBe(19 * (MAX_SPLIT_GROUPS - 1));
  expect(notifications).toBe(0);
  expect(invocations.filter((command) => command !== "list_providers")).toEqual([]);
  expect(closedCopies).toBe(200);
  expect(closedBytes).toBeLessThan(bytes + 200 * (sql.length + 200));
  expect(openCopies).toBe(0);
  expect(follow.p95Ms / 100).toBeLessThan(1);
  expect(move.p95Ms / 100).toBeLessThan(1);
  expect(save.p95Ms / 20).toBeLessThan(1);
  expect(open.p95Ms / 20).toBeLessThan(2);
  expect(reopen.p95Ms).toBeLessThan(40);
  expect(close.p95Ms / 50).toBeLessThan(2);
  expect(adopt.p95Ms).toBeLessThan(20);
  expect(foreign.p95Ms / 100).toBeLessThan(0.5);
  expect(idle.p95Ms / 100).toBeLessThan(0.1);
  expect(bytes).toBeLessThan(1_000_000);
});

test("a large group from another Oracle user maps its schema with a constant number of requests", async () => {
  const { openableGroup } = await import("../src/lib/shared-tab-open");
  const oracle = (user: string) =>
    useConnectionsStore.getState().addConnection({
      name: `${user}@DB`,
      kind: "oracle",
      connectionString: `oracle://${user}@${user.toLowerCase()}.example.com:1521/DB`,
      sslMode: "prefer",
    });
  const home = oracle("APP_PROD");
  const target = oracle("APP_TEST");
  useConnectionsStore.getState().setActiveId(home.id);
  const tabs: Tab[] = Array.from({ length: 500 }, (_, index) => ({
    kind: "table",
    schema: index < 400 ? "APP_PROD" : "SHARED",
    table: `T${index}`,
    entityType: index % 5 === 0 ? "view" : "table",
  }));
  const keys = tabs.map(tabKey);
  useTableTabs.setState({ tabs, tabsByConnection: { [home.id]: tabs } });
  useSplitView.getState().collapse();
  useSplitView.getState().split({ activeKey: keys[0], key: keys[1], edge: "right" });
  for (let index = 2; index < 500; index++) useSplitView.getState().moveTab(keys[index], index % 2);
  const id = useSplitView.getState().activeGroup ?? "";
  useSplitView.getState().setGroupShared(id, true);
  const source = useSplitView.getState().groups[home.id].find((group) => group.id === id);
  if (!source) throw new Error("keine Gruppe");
  useConnectionsStore.getState().setActiveId(target.id);
  const names = (schema: string, start: number, end: number) =>
    Array.from({ length: end - start }, (_, index) => ({ schema, name: `T${start + index}` }));
  respond = (command, args) => {
    if (!String(args?.connectionString ?? "").includes("app_test")) return [];
    if (command === "list_schemas") return ["APP_TEST", "SHARED", "SYS"];
    if (args?.schema === "APP_TEST") return names("APP_TEST", 0, 400);
    if (args?.schema === "SHARED") return names("SHARED", 400, 500);
    return [];
  };

  invocations.length = 0;
  let runs = 0;
  const adopt = await measureScenario(async () => {
    runs++;
    const copy = (await openableGroup(source, home.id)) ?? "";
    useSplitView.getState().openGroup(copy);
    useSplitView.getState().deleteGroup(copy);
    useTableTabs.getState().closeAllTabs();
  });
  const adoptRequests = invocations.length / runs;
  const copy = (await openableGroup(source, home.id)) ?? "";
  const stored = useSplitView.getState().groups[target.id].find((group) => group.id === copy);
  const mapped = stored ? groupPaneTabs(stored).flat() : [];
  invocations.length = 0;
  runs = 0;
  const reopen = await measureScenario(async () => {
    runs++;
    await openableGroup(stored ?? source);
  });
  const reopenRequests = invocations.length / runs;
  respond = () => null;

  await reportScenario("tab-groups-schema-mapping", {
    tabs: tabs.length,
    schemas: 2,
    adopt,
    adoptRequests,
    reopen,
    reopenRequests,
  });
  expect(mapped).toHaveLength(500);
  expect(mapped.filter((tab) => tab.kind === "table" && tab.schema === "APP_TEST")).toHaveLength(
    400,
  );
  expect(mapped.filter((tab) => tab.kind === "table" && tab.schema === "SHARED")).toHaveLength(100);
  expect(adoptRequests).toBe(4);
  expect(reopenRequests).toBe(2);
  expect(adopt.p95Ms).toBeLessThan(40);
  expect(reopen.p95Ms).toBeLessThan(10);
});
