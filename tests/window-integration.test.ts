import { expect, mock, test } from "bun:test";

type StorageListener = (event: { key: string | null; newValue: string | null }) => void;

const listeners: StorageListener[] = [];
const storage = new Map<string, string>();
const keychain = new Map([["new", "s3cret"]]);

mock.module("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: async (command: string, args: Record<string, unknown>) => {
    if (command === "load_secret") return keychain.get(String(args.account)) ?? null;
    return null;
  },
  Resource: class {},
  Channel: class {},
  transformCallback: () => 0,
}));

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    addEventListener: (type: string, listener: StorageListener) => {
      if (type === "storage") listeners.push(listener);
    },
  },
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: window.localStorage,
});

const { useConnectionsStore } = await import("../src/lib/connections");
const { mergeWindowTabs } = await import("../src/lib/table-tabs");
const { dockEntries } = await import("../src/lib/window-integration");

const base = { kind: "postgres" as const, sslMode: "disable" as const, ssh: null };

function emit(key: string) {
  for (const listener of listeners) listener({ key, newValue: storage.get(key) ?? null });
}

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
  emit("l8db.connections");
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

test("tab sync keeps this window's own connection tabs", () => {
  const mine = [{ kind: "query", id: "q1" }] as never[];
  const theirs = [{ kind: "query", id: "q2" }] as never[];
  expect(mergeWindowTabs({ x: theirs, y: theirs }, { x: mine }, "x")).toEqual({
    x: mine,
    y: theirs,
  });
  expect(mergeWindowTabs({ x: theirs }, {}, "x")).toEqual({ x: theirs });
});
