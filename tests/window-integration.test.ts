import { expect, mock, test } from "bun:test";

const storage = new Map<string, string>();
const keychain = new Map([["new", "s3cret"]]);

const desktop = { enabled: false, invokes: [] as string[], pagehide: new Set<() => void>() };

mock.module("@tauri-apps/api/core", () => ({
  isTauri: () => desktop.enabled,
  invoke: async (command: string, args: Record<string, unknown>) => {
    desktop.invokes.push(command);
    if (command === "load_secret") return keychain.get(String(args.account)) ?? null;
    return null;
  },
  Resource: class {},
  Channel: class {},
  transformCallback: () => 0,
  addPluginListener: async () => ({ unregister: async () => {} }),
  PluginListener: class {},
}));

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    addEventListener: (type: string, listener: () => void) => {
      if (type === "pagehide") desktop.pagehide.add(listener);
    },
    removeEventListener: (type: string, listener: () => void) => {
      if (type === "pagehide") desktop.pagehide.delete(listener);
    },
  },
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: window.localStorage,
});

const { useConnectionsStore, syncConnectionsFromStorage } = await import(
  "../src/lib/connections/store"
);
const { mergeWindowTabs } = await import("../src/lib/table-tabs");
const { dockEntries, initWindowIntegration } = await import("../src/lib/window-integration");

const base = { kind: "postgres" as const, sslMode: "disable" as const, ssh: null };

test("another window's connection changes merge without losing local secrets", async () => {
  useConnectionsStore.setState({
    connections: [
      {
        ...base,
        id: "a",
        name: "A",
        connectionString: "postgres://u:pw@h/a",
        tunnelPort: 7000,
      },
      { ...base, id: "gone", name: "Gone", connectionString: "postgres://h/g" },
      { ...base, id: "tmp", name: "Tmp", connectionString: "/tmp/x.db", temporary: true },
    ],
    activeId: "a",
  });
  storage.set(
    "l8db.connections",
    JSON.stringify({
      state: {
        connections: [
          { ...base, id: "a", name: "A renamed", connectionString: "postgres://u@h/a" },
          { ...base, id: "new", name: "New", connectionString: "postgres://u@h/n" },
        ],
        activeId: null,
        recentIds: ["new", "a"],
      },
      version: 0,
    }),
  );
  syncConnectionsFromStorage();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const state = useConnectionsStore.getState();
  expect(state.activeId).toBe("a");
  expect(state.recentIds).toEqual(["new", "a"]);
  expect(state.connections.map((entry) => entry.id)).toEqual(["a", "new", "tmp"]);
  expect(state.connections[0]).toMatchObject({
    name: "A renamed",
    connectionString: "postgres://u:pw@h/a",
    tunnelPort: 7000,
  });
  expect(state.connections[1].connectionString).toBe("postgres://u:s3cret@h/n");
});

test("activating a connection records it as most recent", () => {
  useConnectionsStore.setState({ recentIds: ["b", "a"] });
  useConnectionsStore.getState().setActiveId("a");
  expect(useConnectionsStore.getState().recentIds).toEqual(["a", "b"]);
});

test("dock lists recent connections first, then the rest by name", () => {
  const connections = ["c", "b", "a", "t"].map((id) => ({
    ...base,
    id,
    name: id.toUpperCase(),
    connectionString: "",
    temporary: id === "t",
  }));
  expect(dockEntries(connections, ["c", "t", "missing"])).toEqual([
    { id: "c", name: "C" },
    { id: "a", name: "A" },
    { id: "b", name: "B" },
  ]);
});

test("dock updates stay off the startup path and collapse 1,000 store changes into one call", async () => {
  const connections = Array.from({ length: 500 }, (_, index) => ({
    ...base,
    id: `dock-${index}`,
    name: `Dock ${index}`,
    connectionString: "",
  }));
  useConnectionsStore.setState({ connections, recentIds: [], activeId: "dock-0" });
  desktop.enabled = true;
  desktop.invokes.length = 0;
  const dispose = initWindowIntegration(20);
  const count = (command: string) => desktop.invokes.filter((name) => name === command).length;
  try {
    expect(count("set_window_connection")).toBe(1);
    expect(count("set_dock_recents")).toBe(0);
    for (let index = 0; index < 1000; index++)
      useConnectionsStore.setState({ recentIds: [`dock-${index % 500}`] });
    expect(count("set_dock_recents")).toBe(0);
    await Bun.sleep(60);
    expect(count("set_dock_recents")).toBe(1);
    await Bun.sleep(60);
    expect(count("set_dock_recents")).toBe(1);
    useConnectionsStore.setState({ recentIds: ["dock-7"] });
    expect(count("set_dock_recents")).toBe(1);
    for (const listener of desktop.pagehide) listener();
    expect(count("set_dock_recents")).toBe(2);
    useConnectionsStore.setState({ recentIds: ["dock-8"] });
    dispose();
    expect(desktop.pagehide.size).toBe(0);
    await Bun.sleep(60);
    expect(count("set_dock_recents")).toBe(2);
  } finally {
    dispose();
    desktop.enabled = false;
  }
});

test("tab sync keeps this window's own connection tabs", () => {
  const mine = [{ kind: "query", id: "q1" }] as never[];
  const theirs = [{ kind: "query", id: "q2" }] as never[];
  expect(mergeWindowTabs({ x: theirs, y: theirs }, { x: mine }, "x")).toEqual({
    x: mine,
    y: theirs,
  });
  expect(mergeWindowTabs({ x: theirs }, {}, "x")).toEqual({ x: theirs });
});
