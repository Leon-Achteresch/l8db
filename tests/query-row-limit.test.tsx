import { beforeEach, expect, mock, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SavedConnection } from "../src/lib/connections";
import type { QueryResult } from "../src/lib/db";

const commands: { command: string; sql?: string; jobId?: string }[] = [];
let rowsFor: (sql: string) => number = () => 0;
let pending: ((value: QueryResult) => void) | null = null;
let hold = false;
let savePath: string | null | Promise<string | null> = null;
const jsonWrites: string[] = [];

function result(count: number): QueryResult {
  return {
    columns: ["id"],
    rows: Array.from({ length: count }, (_, id) => ({ id })),
    rows_affected: null,
    execution_time_ms: 1,
  };
}

mock.module("@tauri-apps/api/core", () => ({
  invoke: async (command: string, args: Record<string, unknown> = {}) => {
    commands.push({
      command,
      sql: typeof args.sql === "string" ? args.sql : undefined,
      jobId: typeof args.jobId === "string" ? args.jobId : undefined,
    });
    if (command === "execute_query") {
      if (hold) return new Promise<QueryResult>((resolve) => (pending = resolve));
      return result(rowsFor(String(args.sql)));
    }
    if (command === "cancel_execution") return true;
    if (command === "plugin:dialog|save") return savePath;
    if (command === "plugin:fs|write_text_file") {
      jsonWrites.push(new TextDecoder().decode(args as unknown as Uint8Array));
      return;
    }
    if (command.includes("server_output")) return [];
    return null;
  },
}));

const toasts: { kind: string; message: string; action?: { onClick: () => void } }[] = [];
mock.module("sonner", () => {
  const record =
    (kind: string) => (message: string, data?: { action?: { onClick: () => void } }) => {
      toasts.push({ kind, message, action: data?.action });
      return toasts.length;
    };
  return {
    toast: Object.assign(record("default"), {
      loading: record("loading"),
      success: record("success"),
      info: record("info"),
      error: record("error"),
      warning: record("warning"),
      dismiss: () => undefined,
    }),
  };
});

const { executeSqlWithTransactions } = await import("../src/features/query/query-view/execute-sql");
const { loadFullResult } = await import("../src/features/query/query-view/load-full-result");
const { ResultRowLimitChip } = await import(
  "../src/features/query/query-view/result-row-limit-chip"
);
const { useResultExport } = await import("../src/features/query/query-view/use-result-export");
const { copiedValuesLabel } = await import("../src/features/table/data-table/use-column-actions");
const { autosizeColumnWidth, AUTOSIZE_MAX } = await import("../src/lib/column-header-width");
const { revealColumnScroll } = await import("../src/features/table/data-table/use-grid-scrolling");
const { useSettingsStore } = await import("../src/lib/settings");
const { runSqlScript } = await import("../src/lib/script-runner");

const connection: SavedConnection = {
  id: "row-limit",
  name: "Row limit",
  kind: "postgres",
  connectionString: "postgres://localhost/test",
  sslMode: "disable",
};

const run = (sql: string, rowLimit?: number | null) =>
  executeSqlWithTransactions({
    connection,
    database: null,
    sql,
    transactionsCapable: false,
    onJob: () => undefined,
    rowLimit,
  });

beforeEach(() => {
  commands.length = 0;
  toasts.length = 0;
  hold = false;
  pending = null;
  savePath = null;
  jsonWrites.length = 0;
  rowsFor = (sql) => (/LIMIT 1000/.test(sql) ? 1000 : 5000);
  useSettingsStore.setState({ transactionsEnabled: false });
});

test("results cut by the automatic SELECT limit are marked with the limit", async () => {
  const limited = await run("SELECT * FROM items");
  expect(commands.at(-1)?.sql).toContain("LIMIT 1000");
  expect(limited.autoLimit).toBe(1000);

  rowsFor = () => 12;
  expect((await run("SELECT * FROM items")).autoLimit).toBeUndefined();

  rowsFor = () => 1000;
  expect((await run("SELECT * FROM items LIMIT 1000")).autoLimit).toBeUndefined();
});

test("script runs mark the shown result with the automatic limit", async () => {
  const script = (sql: string) =>
    runSqlScript({ connection, database: null, sql, mode: "autocommit", selectRowLimit: 1000 });
  const limited = await script("SELECT 1;\nSELECT * FROM items;");
  expect(limited.error).toBeNull();
  expect(limited.lastResult?.autoLimit).toBe(1000);

  rowsFor = () => 12;
  expect((await script("SELECT * FROM items;")).lastResult?.autoLimit).toBeUndefined();

  rowsFor = () => 1000;
  expect((await script("SELECT * FROM items LIMIT 1000;")).lastResult?.autoLimit).toBeUndefined();
});

test("unlimited re-run sends the statement without an automatic limit", async () => {
  const full = await run("SELECT * FROM items", null);
  expect(commands.filter((entry) => entry.command === "execute_query")).toHaveLength(1);
  expect(commands[0].sql).toBe("SELECT * FROM items");
  expect(full.rows).toHaveLength(5000);
  expect(full.autoLimit).toBeUndefined();
});

test("the limit chip is labelled with the limit at every width", () => {
  const html = renderToStaticMarkup(
    createElement(ResultRowLimitChip, {
      limit: 1000,
      disabled: false,
      onRunUnlimited: async () => undefined,
    }),
  );
  expect(html).toContain("1.000+</button>");
  expect(html).toContain('aria-label="Auf 1.000 Zeilen begrenzt"');
  expect(html).not.toMatch(/class="[^"]*\bhidden\b/);
});

function exportState(result: QueryResult, loader?: () => Promise<QueryResult>) {
  let state: ReturnType<typeof useResultExport> | null = null;
  function Probe() {
    state = useResultExport(result, loader);
    return null;
  }
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: new QueryClient() }, createElement(Probe)),
  );
  if (!state) throw Error("no state");
  return state as ReturnType<typeof useResultExport>;
}

test("limited results without a full reload are exported as labelled loaded rows", () => {
  const limited = { ...result(1000), autoLimit: 1000 };
  expect(exportState(limited).partial).toBe(true);
  expect(exportState(limited).loadedRows).toBe(1000);
  expect(exportState(limited, async () => result(5000)).partial).toBe(false);
  expect(exportState(result(20)).partial).toBe(false);
});

test("Abbruch des JSON-Speicherdialogs vermeidet das Nachladen von 200.000 Ergebniszeilen", async () => {
  let generatedRows = 0;
  rowsFor = () => {
    generatedRows += 200_000;
    return 200_000;
  };
  const state = exportState({ ...result(1000), autoLimit: 1000 }, () =>
    run("SELECT * FROM items", null),
  );
  const samples: number[] = [];
  for (let i = 0; i < 22; i++) {
    const start = performance.now();
    await state.handleExportJson();
    if (i) samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  console.log(
    `JSON-Export abgebrochen: Median ${samples[10].toFixed(3)} ms, p95 ${samples[19].toFixed(3)} ms, ${generatedRows} geladene Zeilen`,
  );
  expect(generatedRows).toBe(0);
  expect(commands.map((entry) => entry.command)).toEqual(Array(22).fill("plugin:dialog|save"));
  expect(jsonWrites).toHaveLength(0);
  expect(toasts).toHaveLength(0);
  expect(samples[10]).toBeLessThan(3);
  expect(samples[19]).toBeLessThan(10);
});

test("JSON-Export wartet auf den Zielpfad und verhindert doppelte Exporte", async () => {
  const dialog = Promise.withResolvers<string>();
  savePath = dialog.promise;
  const state = exportState({ ...result(1), autoLimit: 1 }, () => run("SELECT * FROM items", null));
  const first = state.handleExportJson();
  const repeated = state.handleExportJson();
  state.openCsvExport();
  expect(commands.map((entry) => entry.command)).toEqual(["plugin:dialog|save"]);
  dialog.resolve("/fixtures/result.json");
  await Promise.all([first, repeated]);
  expect(commands.map((entry) => entry.command)).toEqual([
    "plugin:dialog|save",
    "execute_query",
    "plugin:fs|write_text_file",
  ]);
  expect(jsonWrites).toHaveLength(1);
  expect(JSON.parse(jsonWrites[0])).toEqual(result(5000).rows);
});

test("Abbruch beim Nachladen für JSON schreibt keine Datei", async () => {
  savePath = "/fixtures/result.json";
  hold = true;
  const state = exportState({ ...result(1), autoLimit: 1 }, () => run("SELECT * FROM items", null));
  const exporting = state.handleExportJson();
  await Bun.sleep(0);
  expect(commands.at(-1)?.command).toBe("execute_query");
  toasts.find((entry) => entry.kind === "loading")?.action?.onClick();
  pending?.(result(12));
  await exporting;
  expect(toasts.at(-1)?.message).toBe("Export abgebrochen");
  expect(jsonWrites).toHaveLength(0);
});

test("JSON-Export lässt sich nach einem Dialogfehler mit den vorhandenen Zeilen wiederholen", async () => {
  const state = exportState(result(3));
  savePath = Promise.reject(new Error("Dialog nicht verfügbar"));
  await state.handleExportJson();
  expect(toasts.at(-1)?.message).toContain("Dialog nicht verfügbar");
  expect(jsonWrites).toHaveLength(0);
  savePath = "/fixtures/result.json";
  await state.handleExportJson();
  expect(jsonWrites.map((content) => JSON.parse(content))).toEqual([result(3).rows]);
  expect(commands.filter((entry) => entry.command === "execute_query")).toHaveLength(0);
});

test("full export loads the result once and returns every row", async () => {
  let reads = 0;
  const loaded = await loadFullResult(async (onJob) => {
    reads++;
    onJob("job-1");
    return run("SELECT * FROM items", null);
  });
  expect(reads).toBe(1);
  expect(loaded?.rows).toHaveLength(5000);
  expect(commands.filter((entry) => entry.command === "execute_query")).toHaveLength(1);
  expect(toasts.at(-1)).toMatchObject({ kind: "success", message: "5.000 Zeilen geladen" });
});

test("cancelling a full export stops the running read and discards its rows", async () => {
  hold = true;
  const loading = loadFullResult(async (onJob) => {
    onJob("job-cancel");
    return run("SELECT * FROM items", null);
  });
  await Bun.sleep(0);
  toasts.find((entry) => entry.kind === "loading")?.action?.onClick();
  pending?.(result(200_000));
  expect(await loading).toBeNull();
  expect(commands.filter((entry) => entry.command === "cancel_execution")).toHaveLength(1);
  expect(commands.filter((entry) => entry.command === "execute_query")).toHaveLength(1);
  expect(toasts.at(-1)?.message).toBe("Export abgebrochen");
});

test("copy feedback says how many of the known values were copied", () => {
  expect(copiedValuesLabel(100, 25_000)).toBe("100 von 25.000 Werten");
  expect(copiedValuesLabel(100, 100)).toBe("100 Werte");
  expect(copiedValuesLabel(100, null)).toBe("100 geladene Werte");
});

test("autosize fits loaded content between the header width and the cap", () => {
  const rows = [{ name: "a" }, { name: "x".repeat(30) }, { name: null }];
  const format = (value: unknown) => (value == null ? "" : String(value));
  expect(autosizeColumnWidth(rows, "name", 90, format)).toBe(Math.ceil(30 * 7.22 + 26));
  expect(autosizeColumnWidth([{ name: "a" }], "name", 140, format)).toBe(140);
  expect(autosizeColumnWidth([{ name: "x".repeat(5000) }], "name", 90, format)).toBe(AUTOSIZE_MAX);
  expect(autosizeColumnWidth([{ name: "y".repeat(5000) }], "name", 700, format)).toBe(700);
});

test("reduced motion reveals a column instantly with a static highlight", () => {
  const scroller = { scrollLeft: 0 };
  const cells = [
    { style: { outline: "" } },
    { style: { outline: "" } },
  ] as unknown as HTMLElement[];
  const stop = revealColumnScroll(scroller, 480, () => cells, true);
  expect(scroller.scrollLeft).toBe(480);
  expect(cells.every((cell) => cell.style.outline.includes("solid"))).toBe(true);
  stop();
  expect(cells.every((cell) => cell.style.outline === "")).toBe(true);
});
