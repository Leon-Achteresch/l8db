import { beforeEach, describe, expect, test } from "bun:test";

const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
};
const windowMock = Object.assign(new EventTarget(), { localStorage: localStorageMock });
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });
Object.defineProperty(globalThis, "window", { value: windowMock, configurable: true });

const { useNotebookStore } = await import("../src/lib/notebook/store.ts?window-sync");

const KEY = "l8db.notebook";

function doc(name: string, source: string) {
  return {
    name,
    connectionId: null,
    saveResults: false,
    cells: [{ id: "c1", type: "sql" as const, source }],
  };
}

function otherWindowWrites(state: unknown): void {
  const value = JSON.stringify({ state, version: 1 });
  storage.set(KEY, value);
  window.dispatchEvent(Object.assign(new Event("storage"), { key: KEY, newValue: value }));
}

beforeEach(() => {
  storage.clear();
  useNotebookStore.setState({
    doc: doc("Local", "select 1"),
    filePath: null,
    dirty: false,
    restored: false,
    recent: [{ path: "/a.l8nb", name: "A", openedAt: 1 }],
  });
});

describe("notebook across windows", () => {
  test("a clean window follows edits made in another window without a restore banner", () => {
    otherWindowWrites({
      doc: doc("Shared", "select 2"),
      filePath: "/s.l8nb",
      dirty: true,
      recent: [{ path: "/s.l8nb", name: "Shared", openedAt: 5 }],
    });
    const state = useNotebookStore.getState();
    expect(state.doc.cells[0].source).toBe("select 2");
    expect(state.filePath).toBe("/s.l8nb");
    expect(state.dirty).toBe(true);
    expect(state.restored).toBe(false);
    expect(state.recent.map((r) => r.path)).toEqual(["/s.l8nb"]);
  });

  test("the same saved notebook stays in sync while both windows edit it", () => {
    useNotebookStore.setState({ filePath: "/s.l8nb", dirty: true });
    otherWindowWrites({
      doc: doc("Shared", "select 3"),
      filePath: "/s.l8nb",
      dirty: true,
      recent: [],
    });
    expect(useNotebookStore.getState().doc.cells[0].source).toBe("select 3");
  });

  test("an unsaved draft is never replaced by another window's notebook", () => {
    useNotebookStore.setState({ dirty: true });
    otherWindowWrites({
      doc: doc("Other", "drop table x"),
      filePath: null,
      dirty: true,
      recent: [{ path: "/o.l8nb", name: "O", openedAt: 9 }],
    });
    const state = useNotebookStore.getState();
    expect(state.doc.name).toBe("Local");
    expect(state.doc.cells[0].source).toBe("select 1");
    expect(state.dirty).toBe(true);
    expect(state.recent.map((r) => r.path)).toEqual(["/o.l8nb"]);
  });

  test("ignores malformed storage values", () => {
    window.dispatchEvent(Object.assign(new Event("storage"), { key: KEY, newValue: "{" }));
    expect(useNotebookStore.getState().doc.name).toBe("Local");
  });
});
