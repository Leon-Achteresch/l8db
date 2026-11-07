import { beforeEach, expect, mock, test } from "bun:test";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage,
});

let clipboard = "";
mock.module("@tauri-apps/api/core", () => ({ invoke: async () => [] }));
mock.module("@tauri-apps/plugin-clipboard-manager", () => ({
  readText: async () => clipboard,
  writeText: async (text: string) => {
    clipboard = text;
  },
}));
const navigated: unknown[] = [];
mock.module("@/router", () => ({
  router: {
    navigate: async (options: unknown) => void navigated.push(options),
    preloadRoute: async () => undefined,
  },
}));

const { useConnectionsStore } = await import("../src/lib/connections");
const { useTableTabs } = await import("../src/lib/table-tabs");
const { useDbSelectionStore } = await import("../src/lib/db-selection");
const { tableViewStateKey, useTableViewStateStore } = await import("../src/lib/table-view-state");
const { useSavedTabsStore, SAVED_TABS_LIMIT } = await import("../src/lib/saved-tabs");
const shared = await import("../src/lib/shared-tabs");
const open = await import("../src/lib/shared-tab-open");

const conditions = [
  { id: "c1", column: "status", operator: "=", value: "offen ✓", dataType: "text" },
  { id: "c2", column: "total", operator: ">", value: "100" },
];

function addConnection(name: string, connectionString: string, extra: object = {}) {
  const connection = useConnectionsStore.getState().addConnection({
    name,
    kind: "postgres",
    connectionString,
    sslMode: "prefer",
  });
  const updated = { ...connection, ...extra };
  useConnectionsStore.setState((state) => ({
    connections: state.connections.map((entry) => (entry.id === connection.id ? updated : entry)),
  }));
  return updated;
}

beforeEach(() => {
  clipboard = "";
  navigated.length = 0;
  useConnectionsStore.setState({ connections: [], activeId: null });
  useTableTabs.setState({ tabs: [], tabsByConnection: {}, queryCounter: 0 });
  useDbSelectionStore.setState({ databaseByConnection: {}, schemaByConnection: {} });
  useTableViewStateStore.setState({ views: {} });
  useSavedTabsStore.setState({ saved: [] });
  open.useSharedTabRequest.setState({ pending: null });
});

test("table link carries filter and sorting but no credentials, and survives chat text", async () => {
  const mine = addConnection("Shop", "postgresql://leon:geheim@DB.firma.de:5432/shop", {
    ssh: null,
  });
  useConnectionsStore.getState().setActiveId(mine.id);
  const key = String(tableViewStateKey(mine.id, "shop", "public", "orders"));
  useTableViewStateStore.getState().patch(key, {
    filter: "status = 'offen ✓'",
    filterMode: "simple",
    filterConditions: conditions,
    filterCombinator: "AND",
    sorting: [{ id: "created_at", desc: true }],
    page: 7,
    scroll: { top: 900, left: 0, identity: "x" },
  });
  const tab = open.captureSharedTab({ kind: "table", schema: "public", table: "orders" });
  expect(tab).not.toBeNull();
  if (!tab) throw new Error("kein Tab");
  const link = await shared.sharedTabLink(tab);
  expect(link.startsWith(shared.SHARED_TAB_PREFIX)).toBe(true);
  expect(link).toMatch(/^l8db:\/\/tab\/[A-Za-z0-9_-]+$/);
  const decoded = await shared.parseSharedTabLink(`Schau mal hier:\n${link}\nDanke!`);
  expect(decoded).toEqual(tab);
  expect(JSON.stringify(decoded)).not.toContain("geheim");
  expect(JSON.stringify(decoded)).not.toContain("leon");
  expect(decoded?.connection).toEqual({
    name: "Shop",
    kind: "postgres",
    host: "db.firma.de",
    port: "5432",
  });
  expect(decoded?.kind === "table" && decoded.view).toEqual({
    filter: "status = 'offen ✓'",
    filterMode: "simple",
    filterConditions: conditions,
    filterCombinator: "AND",
    sorting: [{ id: "created_at", desc: true }],
  });
});

test("invalid or tampered links are rejected", async () => {
  const base = {
    v: 1,
    connection: { name: "a", kind: "postgres" },
    database: null,
    kind: "query",
    title: "Q",
    sql: "select 1",
  };
  const encode = (value: unknown) =>
    `l8db://tab/j${Buffer.from(JSON.stringify(value)).toString("base64url")}`;
  expect(await shared.parseSharedTabLink(encode(base))).toEqual(base as never);
  expect(await shared.parseSharedTabLink(encode({ ...base, v: 2 }))).toBeNull();
  expect(await shared.parseSharedTabLink(encode({ ...base, kind: "role", name: "x" }))).toBeNull();
  expect(await shared.parseSharedTabLink(encode({ ...base, sql: 5 }))).toBeNull();
  expect(
    await shared.parseSharedTabLink(
      encode({
        v: 1,
        connection: { name: "a", kind: "postgres" },
        database: "x",
        kind: "table",
        schema: "public",
        table: "t",
        entityType: "table",
        view: { filter: "1=1", scroll: { top: 1 } },
      }),
    ),
  ).toBeNull();
  expect(
    await shared.parseSharedTabLink(
      encode({
        v: 1,
        connection: { name: "a", kind: "postgres" },
        database: "x",
        kind: "table",
        schema: "public",
        table: "t",
        entityType: "table",
        view: { sorting: [{ id: "a", desc: "yes" }] },
      }),
    ),
  ).toBeNull();
  expect(await shared.parseSharedTabLink("l8db://tab/@@@")).toBeNull();
  expect(await shared.parseSharedTabLink("l8db://tab/jAAAA")).toBeNull();
  expect(await shared.parseSharedTabLink(`l8db://tab/x${encode(base).slice(12)}`)).toBeNull();
  expect(await shared.parseSharedTabLink("l8db://tab/zAAAA")).toBeNull();
  const bomb = Bun.deflateSync(new Uint8Array(20_000_000).fill(32), { windowBits: -15 });
  expect(
    await shared.parseSharedTabLink(`l8db://tab/z${Buffer.from(bomb).toString("base64url")}`),
  ).toBeNull();
  expect(
    await shared.parseSharedTabLink(`l8db://tab/${"A".repeat(shared.MAX_SHARED_TAB_LINK)}`),
  ).toBeNull();
  expect(await shared.parseSharedTabLink("https://example.com")).toBeNull();
  expect(await shared.parseSharedTabLink(null)).toBeNull();
});

test("large scripts are compressed and decode to the same tab", async () => {
  const sql = Array.from({ length: 2_000 }, (_, index) => `SELECT ${index}, 'Größe' FROM t;`).join(
    "\n",
  );
  const tab = {
    v: 1 as const,
    connection: { name: "a", kind: "postgres" },
    database: "shop",
    kind: "query" as const,
    title: "Abschluss",
    sql,
  };
  const link = await shared.sharedTabLink(tab);
  expect(link.startsWith("l8db://tab/z")).toBe(true);
  expect(link.length).toBeLessThan(sql.length / 5);
  expect(await shared.parseSharedTabLink(` ${link} `)).toEqual(tab);
  const small = await shared.sharedTabLink({ ...tab, sql: "select 1" });
  expect(small.startsWith("l8db://tab/j")).toBe(true);
});

test("colleague connections are matched by team id, then host and port, then name", () => {
  const ref = (connectionString: string, extra: object = {}) =>
    shared.connectionRef({
      id: "x",
      name: "Prod",
      kind: "postgres",
      connectionString,
      sslMode: "prefer",
      ...extra,
    });
  const local = addConnection("lokal", "postgresql://localhost:5432/shop");
  const viaBastion = addConnection("Prod (Tunnel)", "postgresql://localhost:5432/shop", {
    ssh: { host: "Bastion.firma.de", port: 22, user: "x", auth: "agent" },
  });
  const team = addConnection("Team Prod", "postgresql://other:5432/x", {
    team: { hub: "hub", id: "prod-db", base: {} },
  });
  const noPort = addConnection("Reporting", "postgresql://reports.firma.de/analytics");
  const connections = useConnectionsStore.getState().connections;

  expect(
    shared.resolveSharedConnection(
      ref("postgresql://a:5432/x", { team: { hub: "h", id: "prod-db", base: {} } }),
      connections,
    ),
  ).toEqual({ id: team.id, certain: true });
  expect(
    shared.resolveSharedConnection(
      ref("postgresql://u:p@localhost:5432/other", {
        ssh: { host: "bastion.firma.de", port: 22, user: "y", auth: "agent" },
      }),
      connections,
    ),
  ).toEqual({ id: viaBastion.id, certain: true });
  expect(shared.resolveSharedConnection(ref("postgresql://LOCALHOST:5432/x"), connections)).toEqual(
    { id: local.id, certain: true },
  );
  expect(
    shared.resolveSharedConnection(
      ref("postgresql://reports.firma.de:5432/analytics"),
      connections,
    ),
  ).toEqual({ id: noPort.id, certain: false });
  expect(shared.resolveSharedConnection(ref("postgresql://localhost:6543/x"), connections)).toEqual(
    { id: null, certain: false },
  );
  expect(
    shared.resolveSharedConnection(
      { name: "Reporting", kind: "postgres", host: "unknown" },
      connections,
    ),
  ).toEqual({ id: noPort.id, certain: false });
  expect(shared.resolveSharedConnection({ name: "Reporting", kind: "mysql" }, connections)).toEqual(
    { id: null, certain: false },
  );
  const twin = addConnection("Prod (zweiter)", "postgresql://localhost:5432/shop");
  const both = shared.resolveSharedConnection(
    { name: "Prod (zweiter)", kind: "postgres", host: "localhost", port: "5432" },
    useConnectionsStore.getState().connections,
  );
  expect(both).toEqual({ id: twin.id, certain: false });
});

test("opening a shared table applies the filter on the colleague's own connection and database", async () => {
  const colleague = addConnection("Produktion", "postgresql://db.firma.de:5432/postgres");
  const other = addConnection("Test", "postgresql://test:5432/postgres");
  useConnectionsStore.getState().setActiveId(other.id);
  useTableViewStateStore
    .getState()
    .patch(String(tableViewStateKey(colleague.id, "shop", "sales", "orders")), {
      filter: "old",
      filterRaw: true,
      rowRules: [],
    });
  const link = {
    v: 1 as const,
    connection: { name: "Shop", kind: "postgres", host: "db.firma.de", port: "5432" },
    database: "shop",
    kind: "table" as const,
    schema: "sales",
    table: "orders",
    entityType: "view" as const,
    view: {
      filterMode: "sql" as const,
      filterSql: "total > 10",
      filter: "total > 10",
      sorting: [{ id: "id", desc: false }],
    },
  };
  const target = shared.resolveSharedConnection(
    link.connection,
    useConnectionsStore.getState().connections,
  );
  expect(target).toEqual({ id: colleague.id, certain: true });
  expect(await open.openSharedTab(link, colleague.id)).toBe(true);
  expect(useConnectionsStore.getState().activeId).toBe(colleague.id);
  expect(useDbSelectionStore.getState().databaseByConnection[colleague.id]).toBe("shop");
  const view =
    useTableViewStateStore.getState().views[
      String(tableViewStateKey(colleague.id, "shop", "sales", "orders"))
    ];
  expect(view).toMatchObject({
    filter: "total > 10",
    filterRaw: false,
    filterMode: "sql",
    filterSql: "total > 10",
    filterConditions: [],
    sorting: [{ id: "id", desc: false }],
    filterOpen: true,
    page: 0,
  });
  expect(useTableTabs.getState().tabs).toEqual([
    { kind: "table", schema: "sales", table: "orders", entityType: "view" },
  ]);
  expect(navigated.at(-1)).toMatchObject({ params: { schema: "sales", table: "orders" } });
  expect(await open.openSharedTab(link, "missing")).toBe(false);
});

test("a shared query opens as a new tab without running it", async () => {
  const mine = addConnection("Shop", "postgresql://db:5432/shop");
  useConnectionsStore.getState().setActiveId(mine.id);
  useTableTabs.getState().openQueryTabWithSql("select * from kunden where name = 'Jörg'", "Kunden");
  const query = useTableTabs.getState().tabs.find((tab) => tab.kind === "query");
  const captured = query && open.captureSharedTab(query);
  if (!captured) throw new Error("nicht erfasst");
  expect(captured).toMatchObject({ kind: "query", title: "Kunden", database: "shop" });
  useTableTabs.setState({ tabs: [], tabsByConnection: {}, queryCounter: 0 });
  const decoded = await shared.parseSharedTabLink(await shared.sharedTabLink(captured));
  if (!decoded) throw new Error("nicht dekodiert");
  expect(await open.openSharedTab(decoded, mine.id)).toBe(true);
  const [opened] = useTableTabs.getState().tabs;
  expect(opened).toMatchObject({
    kind: "query",
    title: "Kunden",
    sql: "select * from kunden where name = 'Jörg'",
  });
  expect(opened.kind === "query" && opened.autoRun).toBeFalsy();
  expect(open.captureSharedTab({ kind: "role", name: "x" })).toBeNull();
});

test("links always ask, saved tabs open directly only when the connection is unambiguous", async () => {
  const mine = addConnection("Shop", "postgresql://db:5432/shop");
  useConnectionsStore.getState().setActiveId(mine.id);
  const tab = {
    v: 1 as const,
    connection: shared.connectionRef(mine),
    database: "shop",
    kind: "query" as const,
    title: "Q",
    sql: "select 1",
  };
  open.requestSharedTab(tab, "link");
  expect(open.useSharedTabRequest.getState().pending).toEqual({ tab, source: "link" });
  open.useSharedTabRequest.getState().close();

  open.requestSharedTab(tab, "saved");
  await Bun.sleep(0);
  expect(open.useSharedTabRequest.getState().pending).toBeNull();
  expect(
    useTableTabs.getState().tabs.some((entry) => entry.kind === "query" && entry.title === "Q"),
  ).toBe(true);

  const foreign = { ...tab, connection: { name: "Fremd", kind: "postgres", host: "elsewhere" } };
  open.requestSharedTab(foreign, "saved");
  expect(open.useSharedTabRequest.getState().pending?.source).toBe("saved");
});

test("pasting from the clipboard opens the request, junk shows nothing", async () => {
  const tab = {
    v: 1 as const,
    connection: { name: "a", kind: "postgres" },
    database: null,
    kind: "query" as const,
    title: "Q",
    sql: "select 1",
  };
  clipboard = await shared.sharedTabLink(tab);
  await open.openLinkFromClipboard();
  expect(open.useSharedTabRequest.getState().pending?.tab).toEqual(tab);
  open.useSharedTabRequest.getState().close();
  clipboard = "nur Text";
  await open.openLinkFromClipboard();
  expect(open.useSharedTabRequest.getState().pending).toBeNull();
});

test("saved tabs are global, bounded and drop corrupted entries on load", async () => {
  const tab = {
    v: 1 as const,
    connection: { name: "a", kind: "postgres" },
    database: null,
    kind: "query" as const,
    title: "Q",
    sql: "select 1",
  };
  for (let index = 0; index < SAVED_TABS_LIMIT + 25; index++)
    useSavedTabsStore.getState().saveTab(tab, `Tab ${index}`);
  const saved = useSavedTabsStore.getState().saved;
  expect(saved).toHaveLength(SAVED_TABS_LIMIT);
  expect(saved[0].name).toBe(`Tab ${SAVED_TABS_LIMIT + 24}`);
  expect(useSavedTabsStore.getState().saveTab(tab, "  ")?.name).toBe("Q");
  expect(useSavedTabsStore.getState().saveTab({ ...tab, sql: "x".repeat(2_000_000) })).toBeNull();
  useSavedTabsStore.getState().removeTab(saved[0].id);
  expect(useSavedTabsStore.getState().saved.some((entry) => entry.id === saved[0].id)).toBe(false);

  localStorage.setItem(
    "l8db.saved-tabs",
    JSON.stringify({
      state: {
        saved: [
          { id: "ok", name: "ok", tab, createdAt: 1 },
          { id: "bad", name: "bad", tab: { ...tab, v: 9 }, createdAt: 1 },
          null,
        ],
      },
      version: 0,
    }),
  );
  await useSavedTabsStore.persist.rehydrate();
  expect(useSavedTabsStore.getState().saved.map((entry) => entry.id)).toEqual(["ok"]);
});

test("review fixes: hidden filters, stale filter mode, foreign kinds, duplicates, quota and size", async () => {
  const mine = addConnection("Prod", "postgresql://db.firma.de:5432/shop");
  const mysql = useConnectionsStore.getState().addConnection({
    name: "Maria",
    kind: "mysql",
    connectionString: "mysql://maria:3306/crm",
    sslMode: "prefer",
  });
  useConnectionsStore.getState().setActiveId(mine.id);
  const key = String(tableViewStateKey(mine.id, "shop", "public", "orders"));
  useTableViewStateStore.getState().patch(key, { filterMode: "sql", filterCombinator: "OR" });
  const hidden = {
    v: 1 as const,
    connection: { name: "Prod", kind: "postgres", host: "db.firma.de", port: "5432" },
    database: "shop",
    kind: "table" as const,
    schema: "public",
    table: "orders",
    entityType: "table" as const,
    view: { filterMode: "sql" as const, filterSql: "1=1", filter: "1=1 AND pg_sleep(30) IS NULL" },
  };
  expect(shared.effectiveSharedView(hidden.view).filter).toBe("1=1");
  await open.openSharedTab(hidden, mine.id);
  expect(useTableViewStateStore.getState().views[key]).toMatchObject({
    filter: "1=1",
    filterSql: "1=1",
  });
  await open.openSharedTab(
    { ...hidden, view: { filter: "a = 1", filterConditions: conditions } },
    mine.id,
  );
  expect(useTableViewStateStore.getState().views[key]).toMatchObject({
    filter: "a = 1",
    filterMode: "simple",
    filterCombinator: "AND",
  });

  await open.openSharedTab(hidden, mysql.id);
  expect(useDbSelectionStore.getState().databaseByConnection[mysql.id]).toBeUndefined();

  const query = { ...hidden, kind: "query" as const, title: "Q", sql: "select 1" };
  const first = useSavedTabsStore.getState().saveTab(query, "Q");
  const second = useSavedTabsStore.getState().saveTab(query, "Q");
  expect(useSavedTabsStore.getState().saved.map((entry) => entry.id)).toEqual([second?.id]);
  expect(first?.id).not.toBe(second?.id);

  const setItem = localStorage.setItem;
  localStorage.setItem = () => {
    throw new DOMException("voll", "QuotaExceededError");
  };
  try {
    expect(useSavedTabsStore.getState().saveTab(query, "anders")).toBeNull();
  } finally {
    localStorage.setItem = setItem;
  }
  expect(useSavedTabsStore.getState().saved.map((entry) => entry.id)).toEqual([second?.id]);

  const random = Array.from({ length: 2_000_000 }, () => Math.random().toString(36)[2]).join("");
  await expect(shared.sharedTabLink({ ...query, sql: random })).rejects.toThrow("zu groß");
});
