import { expect, test } from "bun:test";
import { measureScenario, reportScenario } from "../scripts/performance-report";

Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: (globalThis as unknown as { window: { localStorage: Storage } }).window.localStorage,
});

const { readViewStates, VIEW_STATE_LIMIT, writeViewState } = await import(
  "../src/lib/editor-view-states"
);
const { queryTabScope, readTabState, TAB_STATE_LIMIT, tabStateKey, tabStateSize, writeTabState } =
  await import("../src/lib/tab-state");
const { useTableTabs } = await import("../src/lib/table-tabs");

function viewState(line: number) {
  return {
    cursorState: [
      {
        inSelectionMode: false,
        selectionStart: { lineNumber: line, column: 1 },
        position: { lineNumber: line, column: 12 },
      },
    ],
    viewState: {
      scrollLeft: 0,
      firstPosition: { lineNumber: line, column: 1 },
      firstPositionDeltaTop: 0,
    },
    contributionsState: {
      "editor.contrib.folding": {
        lineCount: 12_000,
        provider: "indent",
        foldedImports: false,
        collapsedRegions: Array.from({ length: 20 }, (_, index) => ({
          startLineNumber: index * 40 + 1,
          endLineNumber: index * 40 + 30,
          isCollapsed: true,
        })),
      },
    },
  } as unknown as Parameters<typeof writeViewState>[1];
}

test("editor view states stay bounded while thousands of object tabs are visited", async () => {
  let written = 0;
  for (; written < 300; written++) writeViewState(`object:${written}`, viewState(written + 1));
  const write = await measureScenario(() => {
    for (let index = 0; index < 20; index++) {
      writeViewState(`object:${written}`, viewState(written + 1));
      written++;
    }
  });
  const stored = readViewStates();
  const bytes = localStorage.getItem("l8db.editor-view-state")?.length ?? 0;
  writeViewState("object:0", viewState(7));
  await reportScenario("editor-view-state-lru", {
    writes: written,
    entries: Object.keys(stored).length,
    bytes,
    write,
  });
  expect(Object.keys(stored)).toHaveLength(VIEW_STATE_LIMIT);
  expect(stored[`object:${written - 1}`]).toBeDefined();
  expect(stored["object:1"]).toBeUndefined();
  expect(readViewStates()["object:0"]?.cursorState[0]?.position.lineNumber).toBe(7);
  expect(bytes).toBeLessThan(VIEW_STATE_LIMIT * 2_048);
  expect(write.p95Ms / 20).toBeLessThan(5);
});

test("tab state stays bounded and frees query results when their tab closes", async () => {
  const rows = Array.from({ length: 5_000 }, (_, index) => [index, `customer ${index}`, index * 3]);
  const tabs = Array.from({ length: 20 }, (_, index) => ({
    kind: "query" as const,
    id: `perf-${index}`,
    title: `Query ${index}`,
    sql: "SELECT 1",
  }));
  useTableTabs.setState({ tabs, tabsByConnection: {} });
  for (const tab of tabs) {
    writeTabState(tabStateKey(queryTabScope(tab.id), "result"), { columns: ["id"], rows });
  }

  let counter = 0;
  const write = await measureScenario(() => {
    for (let index = 0; index < 1_000; index++) {
      writeTabState(tabStateKey(`bucket:conn:${counter % 2_000}`, "search"), `term ${counter}`);
      counter++;
    }
  });
  const sizeAfterWrites = tabStateSize();

  for (const tab of tabs) {
    writeTabState(tabStateKey(queryTabScope(tab.id), "result"), { columns: ["id"], rows });
  }
  const unchangedTabs = await measureScenario(() => {
    useTableTabs.setState({ tabs: [...tabs] });
  });
  const close = performance.now();
  useTableTabs.setState({ tabs: tabs.slice(0, 1) });
  const closeMs = performance.now() - close;
  writeTabState(tabStateKey(queryTabScope("perf-1"), "result"), { columns: ["id"], rows });

  await reportScenario("tab-state-store", {
    writes: counter,
    entries: sizeAfterWrites,
    limit: TAB_STATE_LIMIT,
    resultRows: rows.length,
    queryTabs: tabs.length,
    write,
    unchangedTabs,
    closeMs,
  });
  expect(sizeAfterWrites).toBeLessThanOrEqual(TAB_STATE_LIMIT);
  expect(readTabState(tabStateKey(queryTabScope("perf-0"), "result"))).toBeDefined();
  expect(readTabState(tabStateKey(queryTabScope("perf-1"), "result"))).toBeUndefined();
  expect(readTabState(tabStateKey(queryTabScope("perf-1"), "running"))).toBeUndefined();
  expect(readTabState(tabStateKey(queryTabScope("perf-19"), "result"))).toBeUndefined();
  expect(tabStateSize()).toBeLessThanOrEqual(TAB_STATE_LIMIT - tabs.length + 1);
  expect(write.p95Ms / 1_000).toBeLessThan(0.05);
  expect(unchangedTabs.p95Ms).toBeLessThan(2);
  expect(closeMs).toBeLessThan(25);
});
