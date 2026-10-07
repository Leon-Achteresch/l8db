import { beforeEach, expect, test } from "bun:test";

const storage = new Map<string, string>();
const events = new EventTarget();
Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    dispatchEvent: events.dispatchEvent.bind(events),
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  },
  configurable: true,
});

const { useConnectionsStore } = await import("../src/lib/connections");
const { useTableTabs, tabKey } = await import("../src/lib/table-tabs");
const { addWorkbenchTab, closeWorkbenchTab, setWorkbenchBusy, useWorkbenchTabs, workbenchTabBusy } =
  await import("../src/lib/workbench-tabs");

beforeEach(() => {
  useConnectionsStore.setState({ connections: [], activeId: null });
  useTableTabs.setState({ tabs: [], tabsByConnection: {}, recentlyClosed: [] });
  useWorkbenchTabs.setState({ entries: [] });
});

function addEntry(id = "editor") {
  const entry = {
    id,
    title: "Rollen-Editor",
    content: "sensitive draft",
    connectionId: useConnectionsStore.getState().activeId,
    database: "original_database",
    container: {} as HTMLDivElement,
    busy: false,
    returnTo: "/users",
  };
  addWorkbenchTab(entry);
  return entry;
}

test("keeps the same form container and database while switching connections", () => {
  const a = useConnectionsStore
    .getState()
    .addConnection({
      name: "a",
      kind: "postgres",
      connectionString: "postgresql://localhost/a",
      sslMode: "prefer",
    });
  const b = useConnectionsStore
    .getState()
    .addConnection({
      name: "b",
      kind: "postgres",
      connectionString: "postgresql://localhost/b",
      sslMode: "prefer",
    });
  useConnectionsStore.getState().setActiveId(a.id);
  const entry = addEntry();
  const tab = useTableTabs.getState().tabs[0];
  expect(tab.kind === "tool" && tab.title).toBe("Rollen-Editor");
  useConnectionsStore.getState().setActiveId(b.id);
  expect(useTableTabs.getState().tabs).toHaveLength(0);
  expect(useWorkbenchTabs.getState().entries[0].container).toBe(entry.container);
  expect(useWorkbenchTabs.getState().entries[0].database).toBe("original_database");
  useConnectionsStore.getState().setActiveId(a.id);
  expect(useTableTabs.getState().tabs[0]).toEqual(tab);
});

test("never persists live forms or keeps closed forms in recovery", () => {
  addEntry();
  useTableTabs.getState().openQueryTabWithSql("SELECT 1");
  const options = useTableTabs.persist.getOptions();
  const saved = options.partialize?.(useTableTabs.getState());
  expect(JSON.stringify(saved)).not.toContain("workbench");
  expect(JSON.stringify(saved)).not.toContain("sensitive draft");
  expect(JSON.stringify(saved)).toContain("SELECT 1");
  useTableTabs.getState().closeTab("tool:workbench:editor");
  expect(useWorkbenchTabs.getState().entries).toHaveLength(0);
  expect(useTableTabs.getState().recentlyClosed).toHaveLength(0);
});

test("tracks running actions and allows the form to close after success", () => {
  addEntry();
  const tab = useTableTabs.getState().tabs[0];
  setWorkbenchBusy("editor", true);
  expect(workbenchTabBusy(tab)).toBe(true);
  let request = "";
  const handler = (event: Event) => {
    request = (event as CustomEvent<string>).detail;
  };
  events.addEventListener("l8db:request-close-tab", handler);
  closeWorkbenchTab("editor");
  expect(request).toBe(tabKey(tab));
  expect(workbenchTabBusy(tab)).toBe(false);
  events.removeEventListener("l8db:request-close-tab", handler);
});

test("cleans all form contents when their connection is removed", () => {
  const connection = useConnectionsStore
    .getState()
    .addConnection({
      name: "a",
      kind: "postgres",
      connectionString: "postgresql://localhost/a",
      sslMode: "prefer",
    });
  useConnectionsStore.getState().setActiveId(connection.id);
  addEntry();
  useTableTabs.getState().clearTabsForConnection(connection.id);
  expect(useWorkbenchTabs.getState().entries).toHaveLength(0);
});
