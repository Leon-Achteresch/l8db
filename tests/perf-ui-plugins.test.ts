import { heapStats } from "bun:jsc";
import { expect, mock, test } from "bun:test";
import { dirname, relative, resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { measureScenario, reportScenario } from "../scripts/performance-report";

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
const calls: string[] = [];

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string) => {
    calls.push(command);
    if (command === "ui_plugins_scan")
      return {
        dir: "/home/perf/.l8db/ui",
        files: [...files].map(([name, source]) => ({ name, source, modified: 0 })),
        skipped: [],
      };
    return null;
  },
}));
const realEvent = await import("@tauri-apps/api/event");
mock.module("@tauri-apps/api/event", () => ({
  ...realEvent,
  listen: async () => () => undefined,
}));

const { UI_PLUGIN_MODULES } = await import("../src/features/ui-plugins/sdk-modules");
const { startUiPluginHost, reloadUiPlugins } = await import("../src/lib/ui-plugins/host");
const { uiPluginRegistry, useUiPluginRuntime } = await import("../src/lib/ui-plugins/store");
const { useUiPluginSettings } = await import("../src/lib/ui-plugins/settings");
const { columnDefaults, createPluginGrid } = await import("../src/lib/ui-plugins/grid");
const { columnInfos, tableInfo } = await import("../src/lib/ui-plugins/info");
const { publishPluginSelection, pluginSelection } = await import(
  "../src/lib/ui-plugins/table-slots"
);
const { Board } = await import("../src/features/ui-plugins/sdk/board");

const ROWS = 2_000;
const COLUMNS = 24;
const VISIBLE_ROWS = 40;
const VISIBLE_COLUMNS = 12;

const PLUGINS: Record<string, string> = {
  "a-status.tsx": `import { asText, definePlugin, Pill } from "@l8db/ui";
const TONES = new Map([["offen", "warning"], ["bezahlt", "success"], ["storniert", "danger"]]);
export default definePlugin({
  id: "perf.status",
  options: { columns: { type: "text", label: "Spalten", default: "status,state" } },
  slots: (options) => {
    const names = new Set(asText(options.columns).split(","));
    return {
      grid: {
        cell: ({ column, value }) => names.has(column.id) ? <Pill tone={TONES.get(asText(value)) ?? "neutral"}>{asText(value)}</Pill> : undefined,
        rowTone: (row) => (row.status === "storniert" ? "danger" : undefined),
      },
    };
  },
});`,
  "b-money.tsx": `import { definePlugin, formatNumber, Text } from "@l8db/ui";
const NUMERIC = /^(numeric|decimal|money|integer)/;
export default definePlugin({
  id: "perf.money",
  slots: {
    grid: {
      columns: (_table, columns) => columns.filter((column) => column.id.startsWith("total")).map((column) => ({ id: column.id, align: "end" })),
      cell: ({ column, value }) => column.id.startsWith("total") && NUMERIC.test(column.type) ? <Text mono>{formatNumber(value, { currency: "EUR" })}</Text> : undefined,
    },
  },
});`,
  "c-bars.tsx": `import { asNumber, Bar, definePlugin } from "@l8db/ui";
export default definePlugin({
  id: "perf.bars",
  slots: {
    grid: {
      cell: ({ column, value }) => {
        if (!column.id.endsWith("_percent")) return undefined;
        const number = asNumber(value);
        return number === null ? undefined : <Bar value={number} max={100} tone={number < 30 ? "danger" : "success"} />;
      },
    },
  },
});`,
  "d-other-tables.tsx": `import { definePlugin, Badge } from "@l8db/ui";
export default definePlugin({
  id: "perf.other",
  slots: { grid: { cell: ({ table, value }) => (table.id === "crm.tickets" ? <Badge>{String(value)}</Badge> : undefined) } },
});`,
  "e-columns.tsx": `import { definePlugin } from "@l8db/ui";
export default definePlugin({
  id: "perf.columns",
  slots: { grid: { columns: (_table, columns) => columns.map((column, index) => ({ id: column.id, label: column.id.replace(/_/g, " "), pinned: index === 0 || undefined, order: index === 0 ? 0 : undefined })) } },
});`,
};

function columnName(index: number) {
  if (index === 0) return "id";
  if (index === 1) return "status";
  if (index === 2) return "total";
  if (index === 3) return "paid_percent";
  return `column_${index}`;
}

const STATUSES = ["offen", "bezahlt", "storniert", "versendet"];
const columnNames = Array.from({ length: COLUMNS }, (_, index) => columnName(index));
const details = columnNames.map((name, index) => ({
  name,
  data_type: index === 2 ? "numeric" : index === 0 || index === 3 ? "integer" : "text",
  is_nullable: index !== 0,
  column_default: null,
  is_primary_key: index === 0,
  ordinal_position: index + 1,
  character_maximum_length: null,
}));
function makeRows(count: number) {
  return Array.from({ length: count }, (_, row) => {
    const record: Record<string, unknown> = { __ctid__: `(0,${row})` };
    for (const [index, name] of columnNames.entries())
      record[name] =
        index === 0
          ? row
          : index === 1
            ? STATUSES[row % STATUSES.length]
            : index === 2
              ? String((row * 7919) % 18_000)
              : index === 3
                ? (row * 37) % 101
                : `value ${row * 13} ${index}`;
    return record;
  });
}

const CONNECTION = {
  id: "perf",
  name: "Perf",
  kind: "postgres" as const,
  connectionString: "postgresql://localhost:5432/perf",
  sslMode: "prefer" as const,
};

async function loadPlugins(sources: Record<string, string>) {
  files.clear();
  for (const [name, source] of Object.entries(sources)) files.set(name, source);
  await reloadUiPlugins();
}

async function settledHeap() {
  Bun.gc(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  Bun.gc(true);
  return { bytes: process.memoryUsage().heapUsed, objects: heapStats().objectCount };
}

function gridFor(rows: Record<string, unknown>[]) {
  const registry = uiPluginRegistry();
  const table = tableInfo(CONNECTION, "perf", "sales", "orders", false);
  const infos = columnInfos(columnNames, details);
  const defaults = columnDefaults(registry.columns ? registry.columns(table, infos) : []);
  return createPluginGrid(registry, table, infos, rows, defaults);
}

test("plugin cells stay cheap on a wide grid and in the visible window", async () => {
  await startUiPluginHost(UI_PLUGIN_MODULES);
  await loadPlugins(PLUGINS);
  expect(Object.keys(useUiPluginRuntime.getState().loaded)).toHaveLength(5);
  const rows = makeRows(ROWS);
  const grid = gridFor(rows);
  let produced = 0;
  const all = await measureScenario(() => {
    produced = 0;
    for (let row = 0; row < ROWS; row++) {
      grid.rowColor?.(rows[row]);
      for (const column of columnNames)
        if (grid.cell?.(rows[row][column], rows[row], column, row)) produced++;
    }
  });
  let offset = 0;
  const visible = await measureScenario(() => {
    offset = (offset + 97) % (ROWS - VISIBLE_ROWS);
    for (let row = offset; row < offset + VISIBLE_ROWS; row++)
      for (const column of columnNames.slice(0, VISIBLE_COLUMNS))
        grid.cell?.(rows[row][column], rows[row], column, row);
  }, 25);
  const cells = ROWS * COLUMNS;
  await reportScenario("ui-plugins-grid-cells", {
    plugins: 5,
    rows: ROWS,
    columns: COLUMNS,
    cells,
    produced,
    all,
    perCellP95Us: (all.p95Ms / cells) * 1000,
    visibleCells: VISIBLE_ROWS * VISIBLE_COLUMNS,
    visible,
  });
  expect(produced).toBe(ROWS * 3);
  expect((all.p95Ms / cells) * 1000).toBeLessThan(5);
  expect(visible.p95Ms).toBeLessThan(3);
});

test("loading many plugins compiles once and unchanged reloads are nearly free", async () => {
  const many: Record<string, string> = {};
  for (let index = 0; index < 30; index++) {
    const name = `p${String(index).padStart(2, "0")}.tsx`;
    many[name] = PLUGINS["a-status.tsx"]
      .replace("perf.status", `perf.many-${index}`)
      .concat(
        Array.from(
          { length: 60 },
          (_, line) => `\nconst filler${line} = [1, 2, 3].map((value) => value * ${line});`,
        ).join(""),
      );
  }
  const sourceBytes = Object.values(many).reduce((sum, source) => sum + source.length, 0);
  let generation = 0;
  const cold = await measureScenario(async () => {
    generation++;
    await loadPlugins(
      Object.fromEntries(
        Object.entries(many).map(([name, source]) => [
          name,
          `${source}\nconst generation = ${generation};`,
        ]),
      ),
    );
  }, 5);
  const loaded = Object.keys(useUiPluginRuntime.getState().loaded).length;
  const unchanged = await measureScenario(() => reloadUiPlugins());
  let edit = 0;
  const single = await measureScenario(async () => {
    edit++;
    files.set("p00.tsx", `${many["p00.tsx"]}\nconst edit = ${edit};`);
    await reloadUiPlugins();
  });
  await reportScenario("ui-plugins-load", {
    plugins: 30,
    sourceBytes,
    cold,
    unchanged,
    single,
  });
  expect(loaded).toBe(30);
  expect(cold.p95Ms).toBeLessThan(150);
  expect(unchanged.p95Ms).toBeLessThan(2);
  expect(single.p95Ms).toBeLessThan(15);
});

test("plugin state stays bounded and the host stays idle", async () => {
  await loadPlugins(PLUGINS);
  const marked = Object.freeze({ id: 1 });
  for (let index = 0; index < 1_000; index++) publishPluginSelection(`tab-${index}`, [marked]);
  const retained = Array.from({ length: 1_000 }, (_, index) =>
    pluginSelection(`tab-${index}`, [marked]),
  ).filter((selection) => selection.length > 0).length;

  const before = await settledHeap();
  for (let round = 0; round < 5; round++) {
    const rows = makeRows(10_000);
    const grid = gridFor(rows);
    for (let row = 0; row < rows.length; row++)
      grid.cell?.(rows[row].status, rows[row], "status", row);
  }
  const after = await settledHeap();
  const retainedBytes = Math.max(0, after.bytes - before.bytes);
  const retainedObjects = Math.max(0, after.objects - before.objects);

  const items = Array.from({ length: 10_000 }, (_, index) => index);
  const markup = renderToStaticMarkup(
    createElement(Board<number>, {
      columns: Array.from({ length: 40 }, (_, index) => ({
        id: `c${index}`,
        label: `C${index}`,
        items,
      })),
      render: (item: number) => createElement("i", null, item),
    }),
  );
  const renderedItems = markup.split("<i>").length - 1;

  calls.length = 0;
  await new Promise((resolve) => setTimeout(resolve, 600));
  const idleCalls = calls.filter((command) => command !== "ui_plugins_write_support").length;

  calls.length = 0;
  const optionStarted = performance.now();
  for (let index = 0; index < 200; index++)
    useUiPluginSettings.getState().setOption("perf.status", "limit", index);
  const optionMs = performance.now() - optionStarted;
  await new Promise((resolve) => setTimeout(resolve, 600));
  const statusWrites = calls.filter((command) => command === "ui_plugins_write_support").length;
  useUiPluginSettings.getState().resetOptions("perf.status");

  await reportScenario("ui-plugins-bounds", {
    publishedTabs: 1_000,
    retainedSelections: retained,
    frozenRows: 50_000,
    retainedBytes,
    retainedObjects,
    boardItemsOffered: 40 * items.length,
    renderedItems,
    idleMs: 600,
    idleCalls,
    optionChanges: 200,
    optionMs,
    statusWrites,
  });
  expect(retained).toBe(20);
  expect(retainedBytes).toBeLessThan(8 * 1024 * 1024);
  expect(retainedObjects).toBeLessThan(5_000);
  expect(renderedItems).toBe(20 * 50);
  expect(idleCalls).toBe(0);
  expect(statusWrites).toBe(1);
  expect(optionMs).toBeLessThan(500);
});

async function importedModules(starts: readonly string[], dynamic: boolean) {
  const root = resolve(import.meta.dir, "..");
  const classic = { compilerOptions: { jsx: "react" as const } };
  const transpilers = {
    ts: new Bun.Transpiler({ loader: "ts" }),
    tsx: new Bun.Transpiler({ loader: "tsx", tsconfig: classic }),
    js: new Bun.Transpiler({ loader: "jsx", tsconfig: classic }),
  };
  const reached = new Set<string>();
  const visit = async (file: string) => {
    if (reached.has(file)) return;
    reached.add(file);
    const extension = file.match(/\.[cm]?([jt]sx?)$/)?.[1];
    if (!extension) return;
    const transpiler =
      extension === "ts" ? transpilers.ts : extension === "tsx" ? transpilers.tsx : transpilers.js;
    for (const entry of transpiler.scanImports(await Bun.file(file).text())) {
      if (entry.kind === "require-call" || entry.path.includes("?") || entry.path === "@/router")
        continue;
      if (!dynamic && entry.kind === "dynamic-import") continue;
      const target = entry.path.startsWith("@/")
        ? resolve(root, "src", entry.path.slice(2))
        : entry.path.startsWith(".")
          ? resolve(dirname(file), entry.path)
          : null;
      if (target) await visit(Bun.resolveSync(target, root));
    }
  };
  for (const start of starts) await visit(resolve(root, start));
  return [...reached].map((file) => relative(root, file).replaceAll("\\", "/"));
}

test("the workspace shell loads the plugin registry, validators and compiler only with the host", async () => {
  const started = performance.now();
  const modules = await importedModules(
    ["src/features/shell/app-layout.tsx", "src/features/shell/workspace-layout.tsx"],
    false,
  );
  await reportScenario("ui-plugins-shell-imports", {
    modules: modules.length,
    scanMs: performance.now() - started,
  });
  expect(modules).toContain("src/features/shell/table-tabs.tsx");
  expect(modules).toContain("src/lib/ui-plugins/store.ts");
  for (const heavy of [
    "src/lib/ui-plugins/host.ts",
    "src/lib/ui-plugins/registry.ts",
    "src/lib/ui-plugins/guard.ts",
    "packages/ui-plugin-api/src/definition.ts",
    "packages/ui-plugin-api/src/modules.ts",
    "packages/ui-plugin-api/src/compile.ts",
  ]) {
    expect(await Bun.file(resolve(import.meta.dir, "..", heavy)).exists()).toBe(true);
    expect(modules).not.toContain(heavy);
  }
});

test("the data grid imports neither the plugin host nor the extension host", async () => {
  const started = performance.now();
  const modules = await importedModules(["src/features/table/data-table.tsx"], true);
  await reportScenario("ui-plugins-grid-imports", {
    modules: modules.length,
    scanMs: performance.now() - started,
  });
  expect(modules).toContain("src/lib/ui-plugins/grid.ts");
  expect(modules).not.toContain("src/lib/ui-plugins/host.ts");
  expect(modules).not.toContain("src/lib/extensions/host.ts");
  expect(modules.some((file) => file.startsWith("src/features/settings/"))).toBe(false);
});
