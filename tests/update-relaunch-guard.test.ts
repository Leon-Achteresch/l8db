import { beforeEach, describe, expect, mock, test } from "bun:test";

const storage = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => void storage.set(key, value),
  removeItem: (key: string) => void storage.delete(key),
};
const windowMock = Object.assign(new EventTarget(), { localStorage: localStorageMock });
Object.defineProperty(globalThis, "localStorage", { value: localStorageMock, configurable: true });
Object.defineProperty(globalThis, "window", { value: windowMock, configurable: true });
if (typeof globalThis.document === "undefined")
  Object.defineProperty(globalThis, "document", {
    value: Object.assign(new EventTarget(), { visibilityState: "visible", hidden: false }),
    configurable: true,
  });

const events: string[] = [];
let backendTransactions: string[] = [];
let backendFails = false;
let onDownloaded: () => void = () => {};

const realCore = await import("@tauri-apps/api/core");

mock.module("@tauri-apps/api/core", () => ({
  ...realCore,
  invoke: async (command: string) => {
    if (command === "list_transactions") {
      if (backendFails) throw new Error("backend unavailable");
      return backendTransactions;
    }
    if (command === "list_providers") return [];
    return null;
  },
  isTauri: () => false,
}));

function fakeUpdate() {
  return {
    version: "9.9.9",
    download: async (onEvent?: (event: unknown) => void) => {
      events.push("download");
      onEvent?.({ event: "Started", data: { contentLength: 10 } });
      onEvent?.({ event: "Progress", data: { chunkLength: 10 } });
      onEvent?.({ event: "Finished" });
      onDownloaded();
    },
    install: async () => {
      events.push(`install:${storage.get("l8db.table-tabs") ? "flushed" : "unflushed"}`);
    },
    downloadAndInstall: async () => {
      events.push("downloadAndInstall");
    },
  };
}

mock.module("@tauri-apps/plugin-updater", () => ({
  check: async () => fakeUpdate(),
}));
mock.module("@tauri-apps/plugin-process", () => ({
  relaunch: async () => {
    events.push("relaunch");
  },
}));
mock.module("sonner", () => ({
  toast: Object.assign((message: string) => events.push(`toast:${message}`), {
    info: (message: string) => events.push(`toast:${message}`),
    error: (message: string) => events.push(`toast:${message}`),
    success: (message: string) => events.push(`toast:${message}`),
    warning: (message: string) => events.push(`toast:${message}`),
  }),
}));

const { useSettingsStore } = await import("../src/lib/settings");
const { runCheck } = await import("../src/lib/auto-updater");
const { getUpdatePromptState, installUpdateAndRelaunch, setPendingUpdate } = await import(
  "../src/lib/updater"
);
const { useTransactionStore } = await import("../src/lib/transactions");
const { useTasksStore } = await import("../src/lib/tasks");
const { useTableTabs } = await import("../src/lib/table-tabs");
const { collectUpdateBlockers, describeUpdateBlockers } = await import(
  "../src/lib/update-blockers"
);

function dirtyQueryTab(id: string) {
  return {
    kind: "query" as const,
    id,
    title: id,
    sql: "select 2",
    savedSql: "select 1",
    filePath: `/tmp/${id}.sql`,
  };
}

beforeEach(() => {
  events.length = 0;
  storage.clear();
  backendTransactions = [];
  backendFails = false;
  onDownloaded = () => {};
  setPendingUpdate(null);
  useTransactionStore.setState({ transactions: [] });
  useTasksStore.setState({ tasks: [] });
  useTableTabs.setState({ tabs: [], tabsByConnection: {} });
  useSettingsStore.setState({
    autoUpdateCheck: true,
    autoUpdateInstall: true,
    skippedUpdateVersion: null,
  });
});

describe("silent auto-update", () => {
  test("installs and relaunches when nothing is pending", async () => {
    await runCheck();
    expect(events).toContain("download");
    expect(events.filter((e) => e.startsWith("install:"))).toHaveLength(1);
    expect(events.at(-1)).toBe("relaunch");
  });

  test("does not relaunch while another window holds an open backend transaction", async () => {
    backendTransactions = ["tx-from-window-2"];
    await runCheck();
    expect(events).not.toContain("relaunch");
    expect(events.some((e) => e.startsWith("install"))).toBe(false);
    expect(events).not.toContain("downloadAndInstall");
    expect(getUpdatePromptState().open).toBe(true);
    expect(getUpdatePromptState().update?.version).toBe("9.9.9");
  });

  test("falls back to the local transaction list when the backend is unreachable", async () => {
    backendFails = true;
    useTransactionStore.setState({
      transactions: [
        {
          txId: "tx-1",
          connectionId: "c1",
          connectionName: "prod",
          changes: [],
          startedAt: 1,
        },
      ],
    });
    await runCheck();
    expect(events).not.toContain("relaunch");
    expect(getUpdatePromptState().open).toBe(true);
  });

  test("does not relaunch while a task is running or cancelling", async () => {
    for (const status of ["running", "cancelling"] as const) {
      events.length = 0;
      setPendingUpdate(null);
      useTasksStore.setState({
        tasks: [{ id: "t1", title: "Export", startedAt: 1, status, cancellable: true }],
      });
      await runCheck();
      expect(events).not.toContain("relaunch");
      expect(events.some((e) => e.startsWith("install"))).toBe(false);
    }
  });

  test("does not relaunch with unsaved query files of any connection", async () => {
    useTableTabs.setState({
      tabs: [],
      tabsByConnection: { other: [dirtyQueryTab("q1")] as never },
    });
    await runCheck();
    expect(events).not.toContain("relaunch");
    expect(getUpdatePromptState().open).toBe(true);
  });

  test("stops before installing when work starts during the download", async () => {
    onDownloaded = () => {
      backendTransactions = ["tx-started-mid-download"];
    };
    await runCheck();
    expect(events).toContain("download");
    expect(events.some((e) => e.startsWith("install"))).toBe(false);
    expect(events).not.toContain("relaunch");
    expect(getUpdatePromptState().open).toBe(true);
  });
});

describe("manual install", () => {
  test("flushes buffered stores before the installer replaces the app", async () => {
    useTableTabs.setState({ tabsByConnection: { c1: [] } });
    expect(storage.get("l8db.table-tabs")).toBeUndefined();
    const installed = await installUpdateAndRelaunch(fakeUpdate() as never);
    expect(installed).toBe(true);
    expect(events).toEqual(["download", "install:flushed", "relaunch"]);
  });
});

describe("update blockers", () => {
  test("counts transactions, active tasks and dirty files across connections once", async () => {
    backendTransactions = ["a", "b", "b"];
    const tab = dirtyQueryTab("q1");
    useTableTabs.setState({
      tabs: [tab] as never,
      tabsByConnection: { c1: [tab, dirtyQueryTab("q2")] as never },
    });
    useTasksStore.setState({
      tasks: [
        { id: "t1", title: "a", startedAt: 1, status: "running", cancellable: false },
        { id: "t2", title: "b", startedAt: 1, status: "success", cancellable: false },
      ],
    });
    const blockers = await collectUpdateBlockers();
    expect(blockers).toEqual({ transactions: 2, tasks: 1, files: 2 });
    expect(describeUpdateBlockers(blockers)).toBe(
      "2 offene Transaktionen · 1 laufende Aufgabe · 2 ungespeicherte Dateien",
    );
    expect(describeUpdateBlockers({ transactions: 0, tasks: 0, files: 0 })).toBeNull();
  });
});
