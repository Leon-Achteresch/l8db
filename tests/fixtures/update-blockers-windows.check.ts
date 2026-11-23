import { beforeEach, describe, expect, mock, test } from "bun:test";

const storage = new Map<string, string>();
const localStorageMock = {
  get length() {
    return storage.size;
  },
  key: (index: number) => [...storage.keys()][index] ?? null,
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
  clear: () => storage.clear(),
};
const windowMock = Object.assign(new EventTarget(), { localStorage: localStorageMock });
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });
Object.defineProperty(globalThis, "window", { value: windowMock, configurable: true });

const realCore = await import("@tauri-apps/api/core");
mock.module("@tauri-apps/api/core", () => ({
  ...realCore,
  invoke: async (command: string) => {
    if (command === "list_transactions") return [];
    if (command === "list_providers") return [];
    return null;
  },
  isTauri: () => false,
}));

const { finishTask, startTask, useTasksStore } = await import("../../src/lib/tasks");
const { collectUpdateBlockers } = await import("../../src/lib/update-blockers");
const { discardStagedTable, stageInsert, stagedTableKey, useStagedEdits } = await import(
  "../../src/lib/staged-edits"
);

function snapshot(): Map<string, string> {
  return new Map(storage);
}

function publishedByThisWindow(before: Map<string, string>): [string, string][] {
  return [...storage].filter(([key, value]) => before.get(key) !== value);
}

const realNow = Date.now;

beforeEach(() => {
  Date.now = realNow;
  useTasksStore.setState({ tasks: [] });
  useStagedEdits.setState({ tables: {}, committing: [] });
  storage.clear();
});

describe("update blockers across windows", () => {
  test("a task running in another window blocks the relaunch", async () => {
    const before = snapshot();
    const id = startTask({ title: "Export" });
    const published = publishedByThisWindow(before).filter(([key]) => key !== "l8db.tasks");
    expect(published.length).toBeGreaterThan(0);
    finishTask(id);
    expect((await collectUpdateBlockers()).tasks).toBe(0);
    for (const [key, value] of published) storage.set(`${key}#other-window`, value);
    expect((await collectUpdateBlockers()).tasks).toBe(1);
  });

  test("a window that vanished without cleaning up does not block forever", async () => {
    const before = snapshot();
    const id = startTask({ title: "Backup" });
    const published = publishedByThisWindow(before).filter(([key]) => key !== "l8db.tasks");
    finishTask(id);
    for (const [key, value] of published) storage.set(`${key}#crashed-window`, value);
    const start = realNow();
    Date.now = () => start + 60 * 60 * 1000;
    expect((await collectUpdateBlockers()).tasks).toBe(0);
  });

  test("closing a window withdraws its running tasks", async () => {
    const before = snapshot();
    startTask({ title: "Import" });
    const published = publishedByThisWindow(before).filter(([key]) => key !== "l8db.tasks");
    window.dispatchEvent(new Event("pagehide"));
    for (const [key] of published) expect(storage.has(key)).toBe(false);
  });

  test("staged grid edits in another window block the relaunch", async () => {
    const target = { connectionId: "c1", database: null, schema: "public", table: "items" };
    const before = snapshot();
    stageInsert(target, { name: "a" });
    stageInsert(target, { name: "b" });
    const published = publishedByThisWindow(before).filter(([key]) =>
      key.startsWith("l8db.window-tasks:"),
    );
    expect(published.length).toBe(1);
    expect((await collectUpdateBlockers()).staged).toBe(2);
    discardStagedTable(stagedTableKey(target));
    expect((await collectUpdateBlockers()).staged).toBe(0);
    for (const [key, value] of published) storage.set(`${key}#other-window`, value);
    expect((await collectUpdateBlockers()).staged).toBeGreaterThan(0);
  });

  test("other windows see the current staged count within a second", async () => {
    const target = { connectionId: "c2", database: null, schema: "public", table: "items" };
    const published = () => {
      const key = [...storage.keys()].find((entry) => entry.startsWith("l8db.window-tasks:"));
      return key ? JSON.parse(storage.get(key) ?? "{}").staged : undefined;
    };
    stageInsert(target, { name: "a" });
    expect(published()).toBe(1);
    stageInsert(target, { name: "b" });
    stageInsert(target, { name: "c" });
    expect(published()).toBe(1);
    await Bun.sleep(1100);
    expect(published()).toBe(3);
    discardStagedTable(stagedTableKey(target));
    expect(published()).toBeUndefined();
  });
});
