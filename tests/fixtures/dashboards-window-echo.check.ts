import { beforeEach, describe, expect, test } from "bun:test";

type Win = EventTarget & { localStorage: Storage };

const storage = new Map<string, string>();
const windows: Win[] = [];
let writer: Win | undefined;

const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
    for (const target of windows)
      if (target !== writer)
        target.dispatchEvent(Object.assign(new Event("storage"), { key, newValue: value }));
  },
  removeItem: (key: string) => void storage.delete(key),
} as unknown as Storage;

function makeWindow(): Win {
  const win = Object.assign(new EventTarget(), { localStorage: localStorageMock });
  windows.push(win);
  return win;
}

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });

const winA = makeWindow();
Object.defineProperty(globalThis, "window", { value: winA, configurable: true, writable: true });
const A = await import("../../src/lib/dashboards/store.ts?echo-a");
const winB = makeWindow();
(globalThis as { window: Win }).window = winB;
const B = await import("../../src/lib/dashboards/store.ts?echo-b");

function flush(win: Win): void {
  writer = win;
  try {
    win.dispatchEvent(new Event("pagehide"));
  } finally {
    writer = undefined;
  }
}

function names(store: typeof A.useDashboardsStore): string[] {
  return store.getState().dashboards.map((d) => d.name);
}

function storedNames(): string[] {
  const value = JSON.parse(storage.get("l8db-dashboards") ?? "null") as {
    state: { dashboards: { name: string }[] };
  } | null;
  return value?.state.dashboards.map((d) => d.name) ?? [];
}

function reset(): void {
  for (const [win, store] of [
    [winA, A.useDashboardsStore],
    [winB, B.useDashboardsStore],
  ] as const) {
    store.setState({ dashboards: [], active: {} });
    flush(win);
  }
  storage.clear();
  flush(winA);
  flush(winB);
}

beforeEach(reset);

describe("dashboards synced between two windows", () => {
  test("an echo from the receiving window never reverts a newer edit", () => {
    B.useDashboardsStore.getState().setActive("connB", "x");
    flush(winB);
    const id = A.useDashboardsStore.getState().add("connA", null, "Sales");
    flush(winA);
    expect(names(B.useDashboardsStore)).toEqual(["Sales"]);
    A.useDashboardsStore.getState().update(id, { name: "Sales v1" });
    flush(winB);
    expect(names(A.useDashboardsStore)).toEqual(["Sales v1"]);
    flush(winA);
    expect(names(B.useDashboardsStore)).toEqual(["Sales v1"]);
    expect(storedNames()).toEqual(["Sales v1"]);
  });

  test("an echo flushed while the receiver had a pending write keeps the newer edit", () => {
    B.useDashboardsStore.getState().setActive("connB", "x");
    const id = A.useDashboardsStore.getState().add("connA", null, "Sales");
    flush(winA);
    A.useDashboardsStore.getState().update(id, { name: "Sales v1" });
    flush(winB);
    expect(names(A.useDashboardsStore)).toEqual(["Sales v1"]);
    flush(winA);
    expect(names(B.useDashboardsStore)).toEqual(["Sales v1"]);
    expect(storedNames()).toEqual(["Sales v1"]);
  });

  test("a write that only changed the active dashboard does not drop a new dashboard", () => {
    A.useDashboardsStore.getState().add("connA", null, "Sales");
    B.useDashboardsStore.getState().setActive("connB", "x");
    flush(winB);
    expect(names(A.useDashboardsStore)).toEqual(["Sales"]);
    flush(winA);
    expect(names(B.useDashboardsStore)).toEqual(["Sales"]);
    expect(storedNames()).toEqual(["Sales"]);
  });

  test("concurrent edits of different dashboards are both kept", () => {
    const one = A.useDashboardsStore.getState().add("c", null, "One");
    const two = A.useDashboardsStore.getState().add("c", null, "Two");
    flush(winA);
    A.useDashboardsStore.getState().update(one, { name: "One A" });
    B.useDashboardsStore.getState().update(two, { name: "Two B" });
    flush(winA);
    flush(winB);
    expect(names(A.useDashboardsStore)).toEqual(["One A", "Two B"]);
    expect(names(B.useDashboardsStore)).toEqual(["One A", "Two B"]);
    expect(storedNames()).toEqual(["One A", "Two B"]);
  });

  test("a removal in one window is adopted by the other", () => {
    const one = A.useDashboardsStore.getState().add("c", null, "One");
    A.useDashboardsStore.getState().add("c", null, "Two");
    flush(winA);
    B.useDashboardsStore.getState().remove(one);
    flush(winB);
    expect(names(A.useDashboardsStore)).toEqual(["Two"]);
    expect(storedNames()).toEqual(["Two"]);
  });

  test("an unchanged echo keeps the local undo history", async () => {
    const id = A.useDashboardsStore.getState().add("c", null, "Sales");
    flush(winA);
    A.clearDashboardHistory();
    await Bun.sleep(450);
    A.useDashboardsStore.getState().update(id, { name: "Sales v1" });
    flush(winA);
    B.useDashboardsStore.getState().setActive("c", id);
    flush(winB);
    A.undoDashboards();
    expect(names(A.useDashboardsStore)).toEqual(["Sales"]);
  });
});
