import { describe, expect, test } from "bun:test";
import type { Capabilities } from "../src/lib/db";
import { isEasyModeRouteVisible, isEasyModeTabVisible } from "../src/lib/easy-mode";
import { availableTableDetailTabs, resolveTableDetailTab } from "../src/lib/table-detail-tabs";
import type { Tab } from "../src/lib/table-tabs/types";

if (typeof window === "undefined") {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } },
  });
}
const { useSettingsStore } = await import("../src/lib/settings");

describe("Easy Mode", () => {
  test("saved mode is available on the first store read after startup", () => {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "-e",
        `
      globalThis.window = { localStorage: {
        getItem: () => JSON.stringify({ state: { easyMode: true }, version: 0 }),
        setItem: () => {},
        removeItem: () => {},
      } };
      const { useSettingsStore } = await import("./src/lib/settings.ts");
      if (!useSettingsStore.persist.hasHydrated() || !useSettingsStore.getState().easyMode) process.exit(1);
    `,
      ],
      { cwd: new URL("..", import.meta.url).pathname },
    );
    expect(result.exitCode).toBe(0);
  });

  test("advanced routes and their subpages are hidden, basic routes remain available", () => {
    for (const path of [
      "/mcp",
      "/versioning",
      "/monitor",
      "/sessions",
      "/replication",
      "/compare",
      "/er-diagram",
      "/saved-plan",
      "/invalid-objects",
      "/enums",
      "/sequences",
      "/dev",
    ]) {
      expect(isEasyModeRouteVisible(path, true)).toBe(false);
      expect(isEasyModeRouteVisible(`${path}/details`, true)).toBe(false);
      expect(isEasyModeRouteVisible(path, false)).toBe(true);
    }
    for (const path of [
      "/",
      "/connections",
      "/settings",
      "/dashboard",
      "/tables/public/monitor",
      "/query/123",
      "/query-builder",
      "/import",
      "/drivers",
    ]) {
      expect(isEasyModeRouteVisible(path, true)).toBe(true);
    }
  });

  test("filtering restored tabs preserves their state for the full mode", () => {
    const tabs: Tab[] = [
      { kind: "tool", tool: "monitor" },
      { kind: "query", id: "draft", title: "Unsaved", sql: "select 1" },
      { kind: "table", schema: "public", table: "users" },
      { kind: "tool", tool: "query-builder" },
    ];
    expect(tabs.filter((tab) => isEasyModeTabVisible(tab, true))).toEqual(tabs.slice(1));
    expect(tabs.filter((tab) => isEasyModeTabVisible(tab, false))).toEqual(tabs);
  });

  test("advanced table details fall back to data without removing basic views", () => {
    const caps = { triggers: true, explain: true, object_grants: true } as Capabilities;
    const tabs = availableTableDetailTabs(false, caps, true);
    expect(tabs.map((tab) => tab.id)).toEqual(["data", "columns"]);
    expect(resolveTableDetailTab("performance", tabs)).toBe("data");
    expect(availableTableDetailTabs(true, caps, true).map((tab) => tab.id)).toEqual([
      "data",
      "columns",
      "definition",
    ]);
    expect(availableTableDetailTabs(false, caps).map((tab) => tab.id)).toContain("performance");
  });

  test("persisted mode hydrates synchronously and old settings retain the full mode", () => {
    const initial = useSettingsStore.getState();
    const options = useSettingsStore.persist.getOptions();
    let saved: { state: Partial<typeof initial>; version?: number } | null = null;
    useSettingsStore.persist.setOptions({
      storage: {
        getItem: () => saved as never,
        setItem: (_, value) => {
          saved = value;
        },
        removeItem: () => {
          saved = null;
        },
      },
    });
    try {
      initial.setRowLimit(250);
      initial.setEasyMode(true);
      const persisted = saved;
      useSettingsStore.setState({ easyMode: false });
      saved = persisted;
      void useSettingsStore.persist.rehydrate();
      expect(useSettingsStore.getState().easyMode).toBe(true);
      expect(useSettingsStore.getState().rowLimit).toBe(250);
      initial.setEasyMode(false);
      expect(saved?.state.easyMode).toBe(false);
      for (const value of [undefined, "true", 1, null]) {
        saved = { state: { rowLimit: 500, easyMode: value as never }, version: 0 };
        void useSettingsStore.persist.rehydrate();
        expect(useSettingsStore.getState().easyMode).toBe(false);
        expect(useSettingsStore.getState().rowLimit).toBe(500);
      }
      initial.setEasyMode(true);
      initial.resetToDefaults();
      expect(useSettingsStore.getState().easyMode).toBe(false);
    } finally {
      useSettingsStore.setState(initial);
      useSettingsStore.persist.setOptions(options);
    }
  });
});
