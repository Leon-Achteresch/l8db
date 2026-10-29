import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { createElement, isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { isPluginError } from "../packages/ui-plugin-api/src/errors";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "window", {
  value: {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
  },
  configurable: true,
});

const files = new Map<string, string>();
const support = new Map<string, string>();
let changed: (() => void) | null = null;

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, string>) => {
    if (command === "ui_plugins_scan")
      return {
        dir: "/home/test/.l8db/ui",
        files: [...files].map(([name, source]) => ({ name, source, modified: 0 })),
        skipped: [],
      };
    if (command === "ui_plugins_write_support") support.set(args.name, args.contents);
    if (command === "ui_plugins_write") files.set(args.name, args.source);
    if (command === "ui_plugins_remove") files.delete(args.name);
    return null;
  },
}));
const realEvent = await import("@tauri-apps/api/event");
mock.module("@tauri-apps/api/event", () => ({
  ...realEvent,
  listen: async (_event: string, handler: () => void) => {
    changed = handler;
    return () => undefined;
  },
}));

const { UI_PLUGIN_MODULES } = await import("../src/features/ui-plugins/sdk-modules");
const { startUiPluginHost, reloadUiPlugins, checkUiPluginSource } = await import(
  "../src/lib/ui-plugins/host"
);
const { useUiPluginRuntime, uiPluginRegistry } = await import("../src/lib/ui-plugins/store");
const { useUiPluginSettings } = await import("../src/lib/ui-plugins/settings");
const { buildRegistry } = await import("../src/lib/ui-plugins/registry");
const { SlotGuard } = await import("../src/lib/ui-plugins/guard");
const { validatePlugin } = await import("../src/lib/ui-plugins/api");
const { arrangeNewTabs } = await import("../src/lib/ui-plugins/tabs-policy");
const { columnDefaults, createPluginGrid, pluginCellState } = await import(
  "../src/lib/ui-plugins/grid"
);
const { evaluatePlugin } = await import("../packages/ui-plugin-api/src/evaluate");
const { createPluginTimers } = await import("../src/lib/ui-plugins/timers");
const { uiPluginStatuses } = await import("../src/lib/ui-plugins/status");
const { pluginHttp } = await import("../src/lib/ui-plugins/http");
const { openTemplate, templateMatches } = await import("../src/lib/ui-plugins/split-templates");
const { publishPluginSelection, pluginSelection } = await import(
  "../src/lib/ui-plugins/table-slots"
);
const { useConnectionsStore } = await import("../src/lib/connections");
const { useMasterDetail } = await import("../src/lib/master-detail");
const { downloadUiPlugin, loadUiPluginCatalog, catalogPluginFileName } = await import(
  "../src/lib/ui-plugins/catalog"
);
const helpers = await import("../packages/ui-plugin-api/src/helpers");

const STATUS = `import { definePlugin, Pill } from "@l8db/ui";
export default definePlugin({
  id: "test.status",
  name: "Status",
  options: { strong: { type: "boolean", label: "Kräftig", default: false } },
  slots: (options) => ({
    grid: {
      cell: ({ table, column, value }) =>
        table.id === "sales.orders" && column.id === "status"
          ? <Pill tone={options.strong ? "danger" : "warning"}>{String(value)}</Pill>
          : undefined,
      rowTone: (row) => (row.status === "storniert" ? "danger" : undefined),
    },
    tabs: { options: { closeButton: "always" } },
  }),
});
`;

const TABLE = Object.freeze({
  id: "sales.orders",
  schema: "sales",
  name: "orders",
  database: null,
  kind: "table" as const,
  connection: Object.freeze({
    id: "c1",
    name: "Prod",
    kind: "postgres",
    environment: "production" as const,
    tags: Object.freeze(["prod"]),
    readOnly: false,
  }),
});

const COLUMN = Object.freeze({ id: "status", type: "text", label: "status", primaryKey: false });

async function settle() {
  await reloadUiPlugins();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

await startUiPluginHost(UI_PLUGIN_MODULES);

beforeEach(async () => {
  files.clear();
  useUiPluginSettings.setState({ disabled: [], options: {}, httpGrants: {}, installed: {} });
  await settle();
});

describe("plugin host", () => {
  test("loads a plugin file, builds the registry and renders cells", async () => {
    files.set("status.tsx", STATUS);
    await settle();
    const state = useUiPluginRuntime.getState();
    expect(Object.keys(state.errors)).toEqual([]);
    expect(state.loaded["status.tsx"].definition.id).toBe("test.status");
    const registry = uiPluginRegistry();
    expect(registry.closeButton).toBe("always");
    const output = registry.cell?.({
      value: "offen",
      row: { status: "offen" },
      column: COLUMN,
      table: TABLE,
      rowIndex: 0,
      rows: [],
    });
    expect(output?.plugin).toBe("test.status");
    expect(isValidElement(output?.node)).toBe(true);
    expect(
      registry.cell?.({
        value: 1,
        row: {},
        column: { ...COLUMN, id: "id" },
        table: TABLE,
        rowIndex: 0,
        rows: [],
      }),
    ).toBeUndefined();
    expect(registry.rowTone?.({ status: "storniert" }, TABLE)).toBe("danger");
  });

  test("applies options from the settings store live", async () => {
    files.set("status.tsx", STATUS);
    await settle();
    const props = { value: "x", row: {}, column: COLUMN, table: TABLE, rowIndex: 0, rows: [] };
    const tone = () =>
      (uiPluginRegistry().cell?.(props)?.node as { props: { tone: string } } | undefined)?.props
        .tone;
    expect(tone()).toBe("warning");
    useUiPluginSettings.getState().setOption("test.status", "strong", true);
    expect(tone()).toBe("danger");
    useUiPluginSettings.getState().setEnabled("test.status", false);
    expect(uiPluginRegistry().cell).toBeNull();
  });

  test("keeps the last working version when an edit breaks the file", async () => {
    files.set("status.tsx", STATUS);
    await settle();
    const working = useUiPluginRuntime.getState().loaded["status.tsx"];
    files.set("status.tsx", `${STATUS}\nconst broken = <div>;\n`);
    changed?.();
    await settle();
    const state = useUiPluginRuntime.getState();
    expect(state.loaded["status.tsx"]).toBe(working);
    expect(state.errors["status.tsx"].line).toBe(STATUS.split("\n").length + 1);
    const status = uiPluginStatuses(state, useUiPluginSettings.getState());
    expect(status[0].state).toBe("stale");
    await new Promise((resolve) => setTimeout(resolve, 300));
    const report = JSON.parse(support.get(".status.json") ?? "{}");
    expect(report.plugins[0]).toMatchObject({ file: "status.tsx", state: "stale" });
  });

  test("rewrites the status file when a plugin is switched off", async () => {
    files.set("status.tsx", STATUS);
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(JSON.parse(support.get(".status.json") ?? "{}").plugins[0].state).toBe("active");
    useUiPluginSettings.setState({ disabled: ["test.status"] });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(JSON.parse(support.get(".status.json") ?? "{}").plugins[0].state).toBe("disabled");
  });

  test("rewrites the status file when a plugin without working slots is switched off", async () => {
    files.set(
      "broken-slots.tsx",
      `import { definePlugin } from "@l8db/ui";
export default definePlugin({
  id: "test.broken-slots",
  name: "Kaputte Slots",
  slots: () => {
    throw new Error("kaputt");
  },
});
`,
    );
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 300));
    const before = JSON.parse(support.get(".status.json") ?? "{}").plugins[0];
    expect(before.state).toBe("active");
    expect(before.slotErrors).toBeDefined();
    useUiPluginSettings.setState({ disabled: ["test.broken-slots"] });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(JSON.parse(support.get(".status.json") ?? "{}").plugins[0].state).toBe("disabled");
  });

  test("does not recompile unchanged files and disposes removed ones", async () => {
    files.set("status.tsx", STATUS);
    await settle();
    const first = useUiPluginRuntime.getState().loaded["status.tsx"];
    await settle();
    expect(useUiPluginRuntime.getState().loaded["status.tsx"]).toBe(first);
    files.delete("status.tsx");
    await settle();
    expect(useUiPluginRuntime.getState().loaded["status.tsx"]).toBeUndefined();
    expect(uiPluginRegistry().plugins).toEqual([]);
  });

  test("rejects duplicate ids and reports blocked APIs with lines", async () => {
    files.set("a.tsx", STATUS);
    files.set("b.tsx", STATUS);
    files.set("c.tsx", 'import { definePlugin } from "@l8db/ui";\nfetch("https://x");\n');
    files.set(
      "d.tsx",
      'import { definePlugin } from "@l8db/ui";\nconst f = (a, b) => b;\nf(0, eval("1"));\n',
    );
    await settle();
    const { errors, loaded } = useUiPluginRuntime.getState();
    expect(Object.keys(loaded)).toEqual(["a.tsx"]);
    expect(errors["b.tsx"].message).toContain("wird schon in a.tsx verwendet");
    expect(errors["c.tsx"]).toMatchObject({ line: 2 });
    expect(errors["c.tsx"].message).toContain("fetch");
    expect(errors["d.tsx"]).toMatchObject({ line: 3 });
    files.delete("a.tsx");
    await settle();
    expect(Object.keys(useUiPluginRuntime.getState().loaded)).toEqual(["b.tsx"]);
    expect(useUiPluginRuntime.getState().errors["b.tsx"]).toBeUndefined();
  });

  test("reports invalid definitions with a helpful message", async () => {
    files.set(
      "bad.tsx",
      'import { definePlugin } from "@l8db/ui";\nexport default definePlugin({ id: "test.bad", slots: { grid: { cells: () => 1 } } });\n',
    );
    await settle();
    expect(useUiPluginRuntime.getState().errors["bad.tsx"].message).toContain(
      'Unbekannter Slot "grid.cells"',
    );
  });

  test("writes the AI support files into the plugin folder", () => {
    expect(support.get("CLAUDE.md")).toBe("@AGENTS.md\n");
    expect(support.get("AGENTS.md")).toContain(".status.json");
    expect(support.get("l8db-ui.d.ts")).toContain("export interface Slots");
    expect(
      JSON.parse(support.get("tsconfig.json") ?? "{}").compilerOptions.paths["@l8db/ui"],
    ).toEqual(["./l8db-ui.d.ts"]);
  });

  test("checks catalog sources before installing", async () => {
    await expect(checkUiPluginSource("x.tsx", STATUS, "test.status")).resolves.toMatchObject({
      id: "test.status",
    });
    await expect(checkUiPluginSource("x.tsx", STATUS, "other.id")).rejects.toThrow("erwartet");
  });
});

describe("runtime isolation", () => {
  test("shadows browser globals inside plugin code", () => {
    const timers = createPluginTimers(() => undefined);
    const result = evaluatePlugin(
      "module.exports = [typeof window, typeof document, typeof fetch, typeof localStorage, typeof globalThis];",
      {},
      timers.globals,
    );
    expect(result).toEqual(["undefined", "undefined", "undefined", "undefined", "undefined"]);
  });

  test("blocks dangerous elements and DOM refs at render time", () => {
    const runtime = UI_PLUGIN_MODULES["react/jsx-runtime"] as {
      jsx: (type: unknown, props: unknown) => unknown;
    };
    const tag = ["scr", "ipt"].join("");
    expect(() => runtime.jsx(tag, {})).toThrow("nicht erlaubt");
    expect(() => runtime.jsx("div", { dangerouslySetInnerHTML: { __html: "x" } })).toThrow();
    expect(() => runtime.jsx("div", { ref: () => undefined })).toThrow("ref");
    expect(isValidElement(runtime.jsx("div", { children: "ok" }))).toBe(true);
    expect(Object.isFrozen(UI_PLUGIN_MODULES.react)).toBe(true);
    expect("createElement" in (UI_PLUGIN_MODULES.react as object)).toBe(false);
  });

  test("shadows eval at runtime", () => {
    expect(evaluatePlugin("module.exports.default = typeof eval;", {})).toBe("undefined");
  });

  test("rejects hooks called directly in slot functions without touching the host", () => {
    const failures: string[] = [];
    const react = UI_PLUGIN_MODULES.react as { useState: (value: number) => unknown };
    const registry = buildRegistry({
      plugins: [
        {
          file: "hooks.tsx",
          definition: validatePlugin({
            id: "a.hooks",
            slots: {
              grid: {
                cell: () => {
                  react.useState(0);
                  return "x";
                },
              },
            },
          }),
        },
      ],
      disabled: [],
      options: {},
      grants: {},
      tripped: {},
      events: {
        error: (_plugin: string, _slot: string, message: string) => failures.push(message),
        trip: () => undefined,
        slotsError: () => undefined,
      },
    });
    expect(
      registry.cell?.({ value: 1, row: {}, column: COLUMN, table: TABLE, rowIndex: 0, rows: [] }),
    ).toBeUndefined();
    expect(failures[0]).toContain("useState ist direkt in Slot-Funktionen nicht erlaubt");
  });

  test("tags errors thrown by plugin components, also behind memo", () => {
    const runtime = UI_PLUGIN_MODULES["react/jsx-runtime"] as {
      jsx: (type: unknown, props: unknown) => ReactElement;
    };
    const react = UI_PLUGIN_MODULES.react as { memo: (type: unknown) => unknown };
    const Boom = () => {
      throw new Error("kaputt");
    };
    const caught = (node: ReactElement) => {
      try {
        renderToStaticMarkup(node);
      } catch (error) {
        return error;
      }
    };
    expect(isPluginError(caught(runtime.jsx(Boom, {})))).toBe(true);
    expect(isPluginError(caught(runtime.jsx(react.memo(Boom), {})))).toBe(true);
    expect(isPluginError(new Error("host", { cause: caught(runtime.jsx(Boom, {})) }))).toBe(true);
    expect(isPluginError(caught(createElement(Boom)))).toBe(false);
    expect(runtime.jsx(Boom, {}).type).toBe(runtime.jsx(Boom, {}).type);
  });

  test("tracks plugin timers and clears them on dispose", async () => {
    const errors: unknown[] = [];
    const timers = createPluginTimers((error) => errors.push(error));
    let ticks = 0;
    timers.globals.setInterval(() => ticks++, 1);
    timers.globals.setTimeout(() => {
      throw new Error("boom");
    }, 1);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(errors).toHaveLength(1);
    expect(ticks).toBeGreaterThan(0);
    expect(ticks).toBeLessThan(6);
    timers.dispose();
    const after = ticks;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(ticks).toBe(after);
    expect(timers.active).toBe(0);
  });
});

describe("registry", () => {
  const events = { error: () => undefined, trip: () => undefined, slotsError: () => undefined };
  const plugin = (id: string, slots: unknown, options = {}) => ({
    file: `${id}.tsx`,
    definition: validatePlugin({ id, slots, options }),
  });
  const base = { disabled: [], options: {}, grants: {}, tripped: {}, events };
  const props = { value: 1, row: {}, column: COLUMN, table: TABLE, rowIndex: 0, rows: [] };

  test("later files win for cells and fall back to earlier plugins", () => {
    const registry = buildRegistry({
      ...base,
      plugins: [
        plugin("a.one", { grid: { cell: () => "eins" } }),
        plugin("b.two", {
          grid: { cell: ({ value }: { value: number }) => (value > 1 ? "zwei" : undefined) },
        }),
      ],
    });
    expect(registry.cell?.(props)?.node).toBe("eins");
    expect(registry.cell?.({ ...props, value: 2 })).toEqual({ plugin: "b.two", node: "zwei" });
  });

  test("later files win for tab items and fall back to earlier plugins", () => {
    const tab = {
      key: "t",
      kind: "table" as const,
      title: "orders",
      connection: null,
      table: null,
    };
    const Default = () => null;
    const registry = buildRegistry({
      ...base,
      plugins: [
        plugin("a.one", { tabs: { item: () => "eins" } }),
        plugin("b.two", {
          tabs: { item: ({ active }: { active: boolean }) => (active ? "zwei" : undefined) },
        }),
      ],
    });
    expect(registry.tabItem?.({ tab, active: false, Default })).toEqual({
      plugin: "a.one",
      node: "eins",
    });
    expect(registry.tabItem?.({ tab, active: true, Default })).toEqual({
      plugin: "b.two",
      node: "zwei",
    });
  });

  test("merges column patches and concatenates toolbar actions", () => {
    const run = () => undefined;
    const registry = buildRegistry({
      ...base,
      plugins: [
        plugin("a.one", {
          grid: { columns: () => [{ id: "status", width: 100, pinned: true }] },
          table: { toolbar: () => [{ id: "copy", label: "Kopieren", run }] },
        }),
        plugin("b.two", {
          grid: { columns: () => [{ id: "status", width: 160, label: "Status" }] },
          table: { toolbar: () => [{ id: "copy", label: "Auch kopieren", run }] },
          split: { options: { autoSaveGroups: false } },
        }),
      ],
    });
    expect(registry.columns?.(TABLE, [COLUMN])).toEqual([
      { id: "status", width: 160, pinned: true, label: "Status" },
    ]);
    expect(registry.toolbar?.(TABLE).map((entry) => entry.key)).toEqual([
      "a.one:copy",
      "b.two:copy",
    ]);
    expect(registry.autoSaveGroups).toBe(false);
  });

  test("skips disabled and tripped plugins and isolates throwing slots", () => {
    const failures: string[] = [];
    const registry = buildRegistry({
      ...base,
      events: {
        ...events,
        error: (_plugin: string, _slot: string, message: string) => failures.push(message),
      },
      disabled: ["c.off"],
      tripped: { "b.tripped:grid.cell": "zu langsam" },
      plugins: [
        plugin("a.throws", {
          grid: {
            cell: () => {
              throw new Error("kaputt");
            },
          },
        }),
        plugin("b.tripped", { grid: { cell: () => "nie" } }),
        plugin("c.off", { grid: { cell: () => "aus" } }),
      ],
    });
    expect(registry.plugins.map((entry) => entry.id)).toEqual(["a.throws", "b.tripped"]);
    expect(registry.cell?.(props)).toBeUndefined();
    expect(failures).toEqual(["kaputt"]);
  });

  test("reports a broken slot factory without breaking other plugins", () => {
    const broken: string[] = [];
    const registry = buildRegistry({
      ...base,
      events: { ...events, slotsError: (id: string) => broken.push(id) },
      plugins: [
        plugin("a.factory", () => {
          throw new Error("nein");
        }),
        plugin("b.fine", { grid: { rowTone: () => "info" } }),
      ],
    });
    expect(broken).toEqual(["a.factory"]);
    expect(registry.rowTone?.({}, TABLE)).toBe("info");
  });

  test("validates slot results at runtime", () => {
    const registry = buildRegistry({
      ...base,
      plugins: [
        plugin("a.tone", { grid: { rowTone: () => "pink" } }),
        plugin("b.layout", { split: { layout: () => "diagonal" } }),
      ],
    });
    expect(registry.rowTone?.({}, TABLE)).toBeUndefined();
    expect(registry.splitLayout?.(3, "horizontal")).toBeUndefined();
  });
});

describe("slot guard", () => {
  test("trips slow slots and stops calling them", () => {
    const trips: string[] = [];
    const guard = new SlotGuard(
      "a.slow",
      "grid.cell",
      {
        error: () => undefined,
        trip: (_plugin, _slot, reason) => trips.push(reason),
      },
      0.05,
    );
    let calls = 0;
    const slow = () => {
      calls++;
      const end = performance.now() + 0.2;
      while (performance.now() < end);
      return "x";
    };
    for (let index = 0; index < 60; index++) guard.run(slow, "fallback");
    expect(guard.tripped).toBe(true);
    expect(trips[0]).toContain("zu langsam");
    expect(guard.run(slow, "fallback")).toBe("fallback");
    expect(calls).toBe(50);
  });

  test("trips exactly when the p95 of the last 200 calls exceeds the budget", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const clock: number[] = [];
    const now = spyOn(performance, "now").mockImplementation(() => clock.shift() ?? 0);
    try {
      for (let round = 0; round < 60; round++) {
        const share = random() * 0.1;
        const durations = Array.from({ length: 600 }, () => (random() < share ? 5 : 1));
        let expected = -1;
        for (let count = 50; count <= durations.length && expected < 0; count += 25) {
          const window = durations.slice(Math.max(0, count - 200), count).sort((a, b) => a - b);
          const p95 = window[Math.min(window.length - 1, Math.floor(window.length * 0.95))];
          if (p95 > 4) expected = count;
        }
        const guard = new SlotGuard("a.p95", "grid.cell", {
          error: () => undefined,
          trip: () => undefined,
        });
        let tripped = -1;
        for (const [index, duration] of durations.entries()) {
          clock.push(0, duration);
          guard.run(() => null, null);
          if (guard.tripped) {
            tripped = index + 1;
            break;
          }
        }
        clock.length = 0;
        expect(tripped).toBe(expected);
      }
    } finally {
      now.mockRestore();
    }
  });

  test("records calls without sorting the window", () => {
    const guard = new SlotGuard("a.sort", "grid.cell", {
      error: () => undefined,
      trip: () => undefined,
    });
    const sort = spyOn(Array.prototype, "sort");
    try {
      for (let index = 0; index < 1000; index++) guard.run(() => null, null);
      expect(sort).not.toHaveBeenCalled();
      expect(guard.tripped).toBe(false);
    } finally {
      sort.mockRestore();
    }
  });

  test("trips after repeated errors and reports only the first", () => {
    const errors: string[] = [];
    const trips: string[] = [];
    const guard = new SlotGuard("a.err", "tabs.group", {
      error: (_plugin, _slot, message) => errors.push(message),
      trip: (_plugin, _slot, reason) => trips.push(reason),
    });
    for (let index = 0; index < 25; index++)
      guard.run(() => {
        throw new Error(`f${index}`);
      }, null);
    expect(errors).toEqual(["f0"]);
    expect(trips).toHaveLength(1);
  });
});

describe("tab policy", () => {
  const tab = (table: string) => ({ kind: "table" as const, schema: "s", table });

  test("opens new tabs right after the most recent active tab", async () => {
    const { tabKey } = await import("../src/lib/table-tabs");
    const previous = [tab("a"), tab("b"), tab("c")];
    const next = [...previous, tab("d"), tab("e")];
    const arranged = arrangeNewTabs(previous, next, {
      position: "afterActive",
      group: null,
      anchor: ["gone", tabKey(tab("a"))],
    });
    expect(arranged?.map((entry) => (entry as { table: string }).table)).toEqual([
      "a",
      "d",
      "e",
      "b",
      "c",
    ]);
  });

  test("joins tabs to their group and ignores closes or reorders", () => {
    const previous = [tab("orders"), tab("users"), tab("order_items")];
    const group = (entry: { kind: string; table?: string }) =>
      entry.table?.startsWith("order") ? "sales" : undefined;
    const arranged = arrangeNewTabs(previous, [...previous, tab("x"), tab("orders_2024")], {
      position: "end",
      group: group as never,
      anchor: [],
    });
    expect(arranged?.map((entry) => (entry as { table: string }).table)).toEqual([
      "orders",
      "users",
      "order_items",
      "orders_2024",
      "x",
    ]);
    expect(
      arrangeNewTabs(previous, previous.slice(1), {
        position: "afterActive",
        group: null,
        anchor: [],
      }),
    ).toBeNull();
    expect(
      arrangeNewTabs(previous, [previous[1], previous[0], previous[2], tab("n")], {
        position: "afterActive",
        group: null,
        anchor: [],
      }),
    ).toBeNull();
  });
});

describe("grid integration", () => {
  test("derives layout defaults from column patches", () => {
    expect(
      columnDefaults([
        { id: "c", order: 2 },
        { id: "a", order: 1, pinned: true, width: 90 },
        { id: "secret", hidden: true },
        { id: "total", align: "end", label: "Summe" },
      ]),
    ).toEqual({
      layout: { order: ["a", "c"], hidden: ["secret"], pinned: ["a"] },
      widths: { a: 90 },
      labels: { total: "Summe" },
      align: { total: "end" },
    });
  });

  test("orders pinned columns by order, then by position", () => {
    expect(
      columnDefaults([
        { id: "free", pinned: true },
        { id: "due", pinned: true, order: 1 },
        { id: "id", pinned: true, order: 0 },
      ]).layout?.pinned,
    ).toEqual(["id", "due", "free"]);
  });

  test("hands frozen copies of rows to plugins", () => {
    const original = { __ctid__: "(0,1)", id: 1, status: "offen" };
    const seen: unknown[] = [];
    const grid = createPluginGrid(
      {
        cell: (props) => {
          seen.push(props.row, props.rows);
          (props.row as Record<string, unknown>).status = "gehackt";
          return undefined;
        },
        rowTone: () => "success",
      },
      TABLE,
      [COLUMN],
      [original],
      {},
    );
    expect(() => grid.cell?.("offen", original, "status", 0)).toThrow();
    expect(original.status).toBe("offen");
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(seen[0]).toEqual({ id: 1, status: "offen" });
    expect(grid.rowColor?.(original)).toBe("#22c55e");
  });

  test("hands deep copies of nested values to plugins", () => {
    const tags = ["b", "a"];
    const original = { id: 1, tags, payload: { nested: [1, 2] } };
    const values: unknown[] = [];
    const grid = createPluginGrid(
      {
        cell: (props) => {
          values.push(props.value, props.row.payload);
          return undefined;
        },
        rowTone: null,
      },
      TABLE,
      [{ ...COLUMN, id: "tags" }],
      [original],
      {},
    );
    grid.cell?.(tags, original, "tags", 0);
    const [value, payload] = values as [string[], { nested: number[] }];
    expect(value).toEqual(["b", "a"]);
    expect(value).not.toBe(tags);
    expect(() => value.sort()).toThrow();
    expect(() => payload.nested.push(3)).toThrow();
    expect(tags).toEqual(["b", "a"]);
  });

  test("keeps one cell state per row and column and skips plain columns", () => {
    const original = { status: "offen", total: 12, note: "x" };
    let calls = 0;
    const grid = createPluginGrid(
      {
        cell: (props) => {
          calls++;
          return props.column.id === "status" ? { plugin: "test.status", node: "pill" } : undefined;
        },
        rowTone: null,
      },
      TABLE,
      [COLUMN, { ...COLUMN, id: "total" }, { ...COLUMN, id: "note" }],
      [original],
      columnDefaults([{ id: "total", align: "end" }]),
    );
    const cells = {
      row: { original, index: 0, getValue: (id: string) => original[id as keyof typeof original] },
      states: new Map(),
    };
    const status = pluginCellState(grid, cells, "status");
    expect(status).toEqual({
      output: { plugin: "test.status", node: "pill" },
      align: undefined,
      resetKey: grid,
    });
    expect(pluginCellState(grid, cells, "status")).toBe(status);
    expect(pluginCellState(grid, cells, "total")).toMatchObject({
      output: undefined,
      align: "end",
    });
    expect(pluginCellState(grid, cells, "note")).toBeUndefined();
    expect(pluginCellState(grid, cells, "note")).toBeUndefined();
    expect(calls).toBe(3);
  });

  test("returns only selected rows that are still loaded", () => {
    const first = Object.freeze({ id: 1 });
    const second = Object.freeze({ id: 2 });
    publishPluginSelection("tab", [first]);
    expect(pluginSelection("tab", [first, second])).toEqual([first]);
    expect(pluginSelection("tab", [Object.freeze({ id: 1 }), second])).toEqual([]);
    expect(pluginSelection(null, [first])).toEqual([]);
  });
});

describe("network access", () => {
  const NET = `import { definePlugin } from "@l8db/ui";
export default definePlugin({ id: "a.net", name: "Netz", permissions: { http: ["api.example.com/v1"] }, slots: { table: { toolbar: () => [] } } });`;
  const loadNet = async (granted: string[]) => {
    files.set("net.tsx", NET);
    useUiPluginSettings.getState().grantHttp("a.net", granted);
    await settle();
    const plugin = uiPluginRegistry().plugins.find((entry) => entry.id === "a.net");
    if (!plugin) throw new Error("a.net fehlt");
    return plugin;
  };

  test("requires https, a declared pattern and a user grant", async () => {
    const plugin = await loadNet([]);
    await expect(pluginHttp(plugin, "http://api.example.com/v1")).rejects.toThrow("https");
    await expect(pluginHttp(plugin, "https://evil.example.com/v1")).rejects.toThrow(
      "permissions.http",
    );
    await expect(pluginHttp(plugin, "https://api.example.com/v1/x")).rejects.toThrow("freigegeben");
  });

  test("fetches granted targets and stops after the grant is revoked or the plugin disabled", async () => {
    const original = globalThis.fetch;
    const requests: string[] = [];
    globalThis.fetch = (async (url: string) => {
      requests.push(String(url));
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;
    try {
      const plugin = await loadNet(["api.example.com/v1"]);
      const response = await pluginHttp(plugin, "https://api.example.com/v1/items");
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
      expect(requests).toEqual(["https://api.example.com/v1/items"]);
      await expect(
        pluginHttp(plugin, "https://api.example.com/v1/x", { method: "TRACE" as never }),
      ).rejects.toThrow("TRACE");
      useUiPluginSettings.getState().grantHttp("a.net", []);
      await expect(pluginHttp(plugin, "https://api.example.com/v1/items")).rejects.toThrow(
        "freigegeben",
      );
      useUiPluginSettings.getState().grantHttp("a.net", ["api.example.com/v1"]);
      useUiPluginSettings.getState().setEnabled("a.net", false);
      await expect(pluginHttp(plugin, "https://api.example.com/v1/items")).rejects.toThrow(
        "deaktiviert",
      );
      expect(requests).toHaveLength(1);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("split templates", () => {
  const template = (when?: object) => ({
    id: "t",
    name: "Kunden",
    when,
    panes: [{ table: "a.b" }, { table: "a.c", master: 0 }],
  });
  const connection = (name: string, tags: string[]) =>
    ({ id: "c", name, tags: tags.map((tag) => ({ name: tag, color: "#000" })) }) as never;

  test("matches connection tags and name patterns", () => {
    expect(templateMatches(template(), undefined)).toBe(true);
    expect(templateMatches(template({ connectionTag: "crm" }), connection("x", ["CRM"]))).toBe(
      true,
    );
    expect(templateMatches(template({ connectionTag: ["crm"] }), connection("x", ["shop"]))).toBe(
      false,
    );
    expect(templateMatches(template({ connectionName: "Prod*" }), connection("Prod EU", []))).toBe(
      true,
    );
    expect(templateMatches(template({ connectionName: "Prod*" }), connection("Staging", []))).toBe(
      false,
    );
  });

  test("keeps an edited relation script when the template opens again", () => {
    useConnectionsStore.setState({
      activeId: "c1",
      connections: [
        {
          id: "c1",
          name: "Prod",
          kind: "postgres",
          connectionString: "postgres://u@localhost/shop",
          tags: [],
        } as never,
      ],
    });
    const entry = {
      plugin: {} as never,
      key: "p:t",
      template: {
        id: "t",
        name: "Kunden",
        panes: [
          { table: "crm.customers" },
          { table: "sales.orders", master: 0, link: { column: "customer_id", masterColumn: "id" } },
        ],
      },
    };
    openTemplate(entry);
    const scripts = useMasterDetail.getState().scripts;
    const key = Object.keys(scripts).find((name) => scripts[name].includes("customer_id"));
    expect(key).toBeDefined();
    const edited = "SELECT * FROM sales.orders WHERE customer_id = :master.id AND status = 'offen'";
    useMasterDetail.getState().saveScript(key as string, edited);
    openTemplate(entry);
    expect(useMasterDetail.getState().scripts[key as string]).toBe(edited);
  });
});

describe("catalog", () => {
  const source = STATUS;
  const digest = async (text: string) =>
    Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
  const url = "https://raw.githubusercontent.com/o/r/catalog/catalog.json";

  test("loads the catalog and verifies plugin hashes", async () => {
    const entry = {
      id: "test.status",
      name: "Status",
      description: "",
      version: "1.0.0",
      author: "test",
      file: "plugins/test.status/plugin.tsx",
      sha256: await digest(source),
      tags: [],
      http: [],
    };
    const fetcher = (async (target: string) =>
      new Response(
        String(target).endsWith("catalog.json")
          ? JSON.stringify({ schemaVersion: 1, plugins: [entry] })
          : source,
      )) as typeof fetch;
    const catalog = await loadUiPluginCatalog(fetcher, url);
    expect(catalog.plugins[0].id).toBe("test.status");
    expect(await downloadUiPlugin(catalog.plugins[0], fetcher, url)).toBe(source);
    expect(catalogPluginFileName(catalog.plugins[0])).toBe("test.status.tsx");
    await expect(
      downloadUiPlugin({ ...catalog.plugins[0], sha256: "0".repeat(64) }, fetcher, url),
    ).rejects.toThrow("Hash");
  });
});

describe("sdk helpers", () => {
  test("convert unknown values safely", () => {
    expect(helpers.asText(null)).toBe("");
    expect(helpers.asText({ a: 1 })).toBe('{"a":1}');
    expect(helpers.asNumber("12.5")).toBe(12.5);
    expect(helpers.asNumber("abc")).toBeNull();
    expect(helpers.asNumber(10n)).toBe(10);
    expect(helpers.asDate("2026-10-29 12:00:00")?.getFullYear()).toBe(2026);
    expect(helpers.asDate("kein Datum")).toBeNull();
    const today = new Date();
    expect(helpers.daysFromToday(today)).toBe(0);
    expect(helpers.formatNumber(1234.5, { decimals: 2 })).toBe("1.234,50");
    expect(helpers.formatNumber(3, { currency: "EUR" })).toContain("€");
    expect(helpers.formatDate("2026-01-02")).toContain("2026");
  });

  test("count calendar days in local time for date-only values", () => {
    const zone = process.env.TZ;
    try {
      for (const name of ["America/New_York", "Pacific/Auckland", "UTC"]) {
        process.env.TZ = name;
        const today = new Date();
        const iso = [
          today.getFullYear(),
          String(today.getMonth() + 1).padStart(2, "0"),
          String(today.getDate()).padStart(2, "0"),
        ].join("-");
        expect(helpers.daysFromToday(iso)).toBe(0);
        expect(helpers.asDate(iso)?.getHours()).toBe(0);
        expect(helpers.asDate("2026-10-29T10:00:00Z")?.toISOString()).toBe(
          "2026-10-29T10:00:00.000Z",
        );
      }
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });
});
