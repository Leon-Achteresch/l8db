import { expect, mock, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { reportScenario } from "../scripts/performance-report";

const invokeCalls: string[] = [];

mock.module("@tauri-apps/api/core", () => ({
  transformCallback: () => 1,
  invoke: async (command: string) => {
    invokeCalls.push(command);
    return [];
  },
}));

function monacoStub(): unknown {
  return new Proxy(class {}, {
    get: (_target, key) =>
      key === "then" ? undefined : key === Symbol.toPrimitive ? () => "" : monacoStub(),
    apply: () => monacoStub(),
    construct: () => monacoStub() as object,
  });
}

mock.module("@/lib/monaco", () => ({
  monaco: monacoStub(),
  activeConnectionKind: () => null,
  activeSqlDialect: () => undefined,
  addSqlFormatAction: () => {},
  isSqlFormattingAvailable: () => false,
  attachPlsqlLint: () => {},
  showQueryAssessment: () => {},
  showSqlError: () => {},
  overflowWidgetsDomNode: () => null,
}));

const { resolveChatContext } = await import("@/lib/ai/chat-context");
const { chatWireMessages } = await import("@/lib/ai/chat-history");
const { useEditorCheckpoints } = await import("@/lib/ai/editor/checkpoints");
const { cleanCompletion, shouldRequest } = await import("@/lib/ai/editor/ghost-text");
const { lensOffsets, MAX_LENS_STATEMENTS } = await import("@/lib/ai/editor/monaco-codelens");
const { findRenameProposal } = await import("@/lib/ai/editor/rename");
const { schemaContextStats } = await import("@/lib/ai/editor/schema-context");
const { resolveTarget, statementBounds } = await import("@/lib/ai/editor/targets");
const { setLastResult } = await import("@/lib/ai/last-result");
const { FALLBACK_PROVIDERS, useProvidersStore } = await import("@/lib/providers");

import type { ChatContextItem } from "@/lib/ai/chat-context";
import type { SavedConnection } from "@/lib/connections";
import type { AiMessage } from "@/lib/db/ai";
import type { ColumnInfo, ForeignKeyInfo, TableInfo } from "@/lib/db/types";
import type { QueryHistoryEntry } from "@/lib/query-history";

useProvidersStore.setState({ providers: FALLBACK_PROVIDERS, loaded: true });

const RUNS = 40;

function percentiles(durations: number[]) {
  const sorted = [...durations].sort((left, right) => left - right);
  return {
    runs: sorted.length,
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    p95Ms: Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(3)),
    maxMs: Number((sorted.at(-1) as number).toFixed(3)),
  };
}

function measure(run: () => void, runs = RUNS) {
  run();
  const durations: number[] = [];
  for (let index = 0; index < runs; index++) {
    const start = performance.now();
    run();
    durations.push(performance.now() - start);
  }
  return percentiles(durations);
}

async function measureAsync(run: () => Promise<void>, runs = RUNS) {
  await run();
  const durations: number[] = [];
  for (let index = 0; index < runs; index++) {
    const start = performance.now();
    await run();
    durations.push(performance.now() - start);
  }
  return percentiles(durations);
}

function retainedBytes(run: () => void): number {
  Bun.gc(true);
  const before = process.memoryUsage().heapUsed;
  run();
  Bun.gc(true);
  return process.memoryUsage().heapUsed - before;
}

function script(statements: number): string {
  const parts: string[] = [];
  for (let index = 0; index < statements; index++) {
    parts.push(
      index % 7 === 0
        ? `-- report ${index}\nselect o.id, o.customer_id, c.email\nfrom orders o\njoin customers c on c.id = o.customer_id\nwhere o.total > ${index};`
        : `/* step ${index} */ update orders set total = total + ${index} where customer_id = ${index} and note <> 'customer_id';`,
    );
  }
  return parts.join("\n\n");
}

test("findRenameProposal scans a 5000-line statement within budget", async () => {
  const lines = ["select"];
  for (let index = 0; index < 4998; index++)
    lines.push(
      `  coalesce(t.customer_id, ${index}) as c_${index}, -- customer_id note\n`.trimEnd() +
        (index % 3 === 0 ? ` 'customer_id'` : ""),
    );
  lines.push("from orders t where t.customer_id is not null");
  const sql = lines.join("\n");
  const edited = { start: sql.indexOf("customer_id"), end: sql.indexOf("customer_id") + 11 };
  let ranges = 0;
  const timing = measure(() => {
    ranges =
      findRenameProposal(sql, { start: 0, end: sql.length }, edited, "customer_id", "client_id")
        ?.ranges.length ?? 0;
  });
  const unlimited = measure(() => {
    findRenameProposal(
      sql,
      { start: 0, end: sql.length },
      edited,
      "customer_id",
      "client_id",
      10_000,
    );
  }, 20);
  const retained = retainedBytes(() => {
    for (let index = 0; index < 50; index++)
      findRenameProposal(sql, { start: 0, end: sql.length }, edited, "customer_id", "client_id");
  });
  await reportScenario("ai-editor-rename", {
    lines: lines.length,
    chars: sql.length,
    ranges,
    rename: timing,
    renameUnlimited: unlimited,
    retainedBytesAfter50Calls: retained,
  });
  expect(ranges).toBe(50);
  expect(timing.medianMs).toBeLessThan(30);
  expect(timing.p95Ms).toBeLessThan(60);
  expect(unlimited.medianMs).toBeLessThan(40);
  expect(retained).toBeLessThan(2_000_000);
});

test("resolveTarget and statementBounds stay fast on a 5000-statement script", async () => {
  const sql = script(5000);
  const middle = sql.indexOf("from orders o", Math.floor(sql.length / 2));
  const end = sql.length - 5;
  let target = resolveTarget(sql, middle, middle);
  const bounds = measure(() => {
    statementBounds(sql, middle);
  }, 20);
  const resolveMiddle = measure(() => {
    target = resolveTarget(sql, middle, middle);
  }, 20);
  const resolveEnd = measure(() => {
    resolveTarget(sql, end, end);
  }, 20);
  const selection = measure(() => {
    resolveTarget(sql, middle, middle + 200);
  });
  await reportScenario("ai-editor-targets", {
    statements: 5000,
    chars: sql.length,
    statementBounds: bounds,
    resolveMiddle,
    resolveEnd,
    resolveSelection: selection,
  });
  expect(target.mode).toBe("statement");
  expect(sql.slice(target.start, target.end)).toContain("from orders o");
  expect(bounds.medianMs).toBeLessThan(40);
  expect(bounds.p95Ms).toBeLessThan(80);
  expect(resolveMiddle.medianMs).toBeLessThan(50);
  expect(resolveMiddle.p95Ms).toBeLessThan(100);
  expect(resolveEnd.medianMs).toBeLessThan(50);
  expect(selection.medianMs).toBeLessThan(1);
});

test("lensOffsets on 5000 statements is bounded by the lens limit", async () => {
  const sql = script(5000);
  let offsets: number[] = [];
  const timing = measure(() => {
    offsets = lensOffsets(sql);
  }, 20);
  const all = measure(() => {
    lensOffsets(sql, undefined, Number.POSITIVE_INFINITY);
  }, 20);
  await reportScenario("ai-editor-codelens", {
    statements: 5000,
    chars: sql.length,
    lenses: offsets.length,
    lensOffsets: timing,
    lensOffsetsUnlimited: all,
  });
  expect(offsets).toHaveLength(MAX_LENS_STATEMENTS);
  expect(lensOffsets(sql, undefined, Number.POSITIVE_INFINITY)).toHaveLength(5000);
  expect(timing.medianMs).toBeLessThan(40);
  expect(timing.p95Ms).toBeLessThan(80);
  expect(all.medianMs).toBeLessThan(60);
});

test("ghost text cleanup and request gating sustain high throughput", async () => {
  const prefix = `${"select id, email from customers where id = 1;\n".repeat(130)}select o.id, o.tot`;
  const linePrefix = "select o.id, o.tot";
  const raw = "```sql\nal, o.customer_id\nfrom orders o\nwhere o.total > 10\n```";
  const multi = Array.from({ length: 40 }, (_, index) => `  and col_${index} = ${index}`).join(
    "\n",
  );
  const suffix = `)\n${"select 1;\n".repeat(150)}`;
  let cleaned = "";
  const clean = measure(() => {
    for (let index = 0; index < 1000; index++) {
      cleaned = cleanCompletion(raw, linePrefix, "");
      cleanCompletion(multi, "where a = 1", suffix);
      cleanCompletion(" FROM t", "SELECT id", "");
    }
  }, 20);
  const gate = measure(() => {
    for (let index = 0; index < 1000; index++) shouldRequest(linePrefix, "", prefix);
  }, 20);
  await reportScenario("ai-editor-ghost-text", {
    callsPerRun: 3000,
    gateCallsPerRun: 1000,
    documentChars: prefix.length,
    clean,
    gate,
  });
  expect(cleaned).toBe("al, o.customer_id\nfrom orders o\nwhere o.total > 10");
  expect(clean.medianMs).toBeLessThan(40);
  expect(clean.p95Ms).toBeLessThan(120);
  expect(gate.medianMs).toBeLessThan(15);
});

test("checkpoints stay within 8M chars over 1000 adds of 420 KB texts", async () => {
  const store = useEditorCheckpoints.getState();
  const durations: number[] = [];
  let maxTotal = 0;
  let maxCount = 0;
  let maxGlobal = 0;
  const baselineBefore = process.memoryUsage().heapUsed;
  let baselineKeep: string[] = [];
  for (let index = 0; index < 1000; index++) {
    const text = `${index}`.padEnd(420_000, "x");
    baselineKeep = [...baselineKeep, index % 2 ? text : `${text}${"z".repeat(50_000)}`].slice(-17);
  }
  baselineKeep = [];
  Bun.gc(true);
  const baselineRetained = process.memoryUsage().heapUsed - baselineBefore;
  Bun.gc(true);
  const heapBefore = process.memoryUsage().heapUsed;
  for (let index = 0; index < 1000; index++) {
    const text = `${index}`.padEnd(420_000, "x");
    const start = performance.now();
    store.add("editor-1", {
      label: `edit ${index}`,
      before: index % 2 ? text : `${text}${"z".repeat(50_000)}`,
    });
    durations.push(performance.now() - start);
    for (const list of Object.values(useEditorCheckpoints.getState().byEditor)) {
      const total = list.reduce((sum, entry) => sum + entry.before.length, 0);
      maxTotal = Math.max(maxTotal, total);
      maxCount = Math.max(maxCount, list.length);
    }
    const all = Object.values(useEditorCheckpoints.getState().byEditor).flat();
    maxGlobal = Math.max(
      maxGlobal,
      all.reduce((sum, entry) => sum + entry.before.length, 0),
    );
  }
  Bun.gc(true);
  const retained = process.memoryUsage().heapUsed - heapBefore;
  const timing = percentiles(durations);
  useEditorCheckpoints.setState({ byEditor: {} });
  Bun.gc(true);
  const retainedAfterClear = process.memoryUsage().heapUsed - heapBefore;
  await reportScenario("ai-editor-checkpoints", {
    adds: 1000,
    charsPerText: 420_000,
    maxTotalChars: maxTotal,
    maxCheckpoints: maxCount,
    maxGlobalChars: maxGlobal,
    retainedHeapBytes: retained,
    retainedAfterClearBytes: retainedAfterClear,
    baselineRetainedBytes: baselineRetained,
    add: timing,
  });
  expect(maxTotal).toBeLessThanOrEqual(8_000_000);
  expect(maxCount).toBeLessThanOrEqual(20);
  expect(maxGlobal).toBeLessThanOrEqual(24_000_000);
  expect(maxTotal).toBeGreaterThan(7_000_000);
  expect(retained).toBeLessThan(64_000_000);
  expect(retainedAfterClear).toBeLessThan(64_000_000);
  expect(timing.medianMs).toBeLessThan(1);
  expect(timing.p95Ms).toBeLessThan(5);
});

test("resolveChatContext with 3000 tables and 30000 columns needs no requests when warm", async () => {
  const connection: SavedConnection = {
    id: "perf-conn",
    name: "Perf",
    kind: "postgres",
    connectionString: "postgres://app@localhost:5432/app",
    sslMode: "prefer",
  };
  const tables: TableInfo[] = [];
  const columns: ColumnInfo[] = [];
  for (let index = 0; index < 3000; index++) {
    const table = {
      schema: `schema_${index % 10}`,
      name: `entity_${String(index).padStart(4, "0")}`,
    };
    tables.push(table);
    for (let col = 0; col < 10; col++)
      columns.push({
        schema: table.schema,
        table: table.name,
        name: col === 0 ? "id" : `field_${col}`,
        data_type: col % 2 ? "text" : "bigint",
      });
  }
  const client = new QueryClient();
  client.setQueryData(["all-columns", connection.id, "app"], columns);
  client.setQueryData(["all-tables", connection.id, "app"], tables);
  const picked = tables.filter((_, index) => index % 375 === 0);
  for (const table of picked) {
    const fks: ForeignKeyInfo[] = [
      {
        constraint_name: `${table.name}_fk`,
        from_schema: table.schema,
        from_table: table.name,
        from_column: "field_1",
        to_schema: "schema_0",
        to_table: "entity_0000",
        to_column: "id",
      },
    ];
    client.setQueryData(["foreign-keys", connection.id, "app", table.schema, table.name], fks);
  }
  const history: QueryHistoryEntry[] = Array.from({ length: 5000 }, (_, index) => ({
    id: `h${index}`,
    connectionId: index % 3 ? connection.id : "other",
    database: "app",
    sql: `select * from entity_${index % 3000} where field_1 = '${index}'`,
    ranAt: index,
    durationMs: 3,
    rowCount: 10,
    error: null,
  }));
  setLastResult({
    owner: "perf",
    connectionId: connection.id,
    sql: "select * from entity_0001",
    result: {
      columns: ["id", "field_1"],
      rows: Array.from({ length: 10_000 }, (_, index) => ({ id: index, field_1: `v${index}` })),
    } as never,
  });
  const items: ChatContextItem[] = [
    ...picked.map((table) => ({
      id: `table:${table.schema}.${table.name}`,
      kind: "table" as const,
      label: table.name,
      schema: table.schema,
      table: table.name,
    })),
    { id: "schema", kind: "schema", label: "Schema" },
    { id: "tab", kind: "tab", label: "Tab" },
    { id: "result", kind: "result", label: "Ergebnis" },
    { id: "history", kind: "history", label: "Verlauf" },
    { id: "sql:1-5000", kind: "sql", label: "SQL Z. 1–5000", sql: script(5000) },
  ];
  const deps = {
    queryClient: client,
    connection,
    database: "app",
    defaultSchema: "schema_0",
    tabSql: script(200),
    history,
    shareValues: false,
  };
  invokeCalls.length = 0;
  let text = await resolveChatContext(items, deps);
  const repeatDeps = { ...deps, recentContext: [text, text, text, text] };
  let repeat = await resolveChatContext(items, repeatDeps);
  const repeatTiming = await measureAsync(async () => {
    repeat = await resolveChatContext(items, repeatDeps);
  });
  const buildsBefore = schemaContextStats().indexBuilds;
  const timing = await measureAsync(async () => {
    text = await resolveChatContext(items, deps);
  });
  const indexBuilds = schemaContextStats().indexBuilds - buildsBefore;
  await reportScenario("ai-chat-context", {
    tables: tables.length,
    columns: columns.length,
    attachedTables: picked.length,
    historyEntries: history.length,
    resultRows: 10_000,
    chars: text.length,
    invokeCalls: invokeCalls.length,
    indexBuilds,
    resolve: timing,
    repeatChars: repeat.length,
    resolveRepeat: repeatTiming,
  });
  expect(invokeCalls).toEqual([]);
  expect(picked).toHaveLength(8);
  expect(text.length).toBeLessThan(30_000);
  expect(indexBuilds).toBe(0);
  expect(timing.medianMs).toBeLessThan(10);
  expect(timing.p95Ms).toBeLessThan(30);
  expect(repeat).toContain("unchanged since an earlier message");
  expect(text.length - repeat.length).toBeGreaterThan(5_000);
  expect(repeatTiming.medianMs).toBeLessThan(10);
  expect(repeatTiming.p95Ms).toBeLessThan(30);
});

test("chatWireMessages compacts a 200-message 2 MB history", async () => {
  const turn: AiMessage[] = Array.from({ length: 200 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? "user" : "assistant",
    text: `${index} ${"y".repeat(10_000)}`,
    context: index % 10 === 0 ? `<context>${"c".repeat(500)}</context>` : undefined,
  }));
  const totalChars = turn.reduce((sum, message) => sum + message.text.length, 0);
  let result = chatWireMessages(turn);
  const cold = measure(() => {
    result = chatWireMessages(turn);
  });
  const summarized = measure(() => {
    chatWireMessages(turn, { upTo: "m193", count: 194, text: "summary" });
  });
  const retained = retainedBytes(() => {
    for (let index = 0; index < 100; index++) chatWireMessages(turn);
  });
  const chars = result.messages.reduce((sum, message) => sum + message.text.length, 0);
  await reportScenario("ai-chat-history", {
    messages: turn.length,
    inputChars: totalChars,
    outputChars: chars,
    keptMessages: result.messages.length,
    compacted: result.compacted,
    summarizeUpTo: result.summarizeUpTo,
    compact: cold,
    compactWithSummary: summarized,
    retainedBytesAfter100Calls: retained,
  });
  expect(totalChars).toBeGreaterThan(2_000_000);
  const keptChars = turn
    .slice(-6)
    .reduce(
      (sum, message) =>
        sum + message.text.length + (message.context ? message.context.length + 2 : 0),
      0,
    );
  expect(result.messages.length).toBe(6);
  expect(chars).toBe(keptChars);
  expect(result.summarizeUpTo).toBe(194);
  expect(cold.medianMs).toBeLessThan(5);
  expect(cold.p95Ms).toBeLessThan(15);
  expect(summarized.medianMs).toBeLessThan(5);
  expect(retained).toBeLessThan(2_000_000);
});

test("chat editor edits on a 5000-statement script stay fast and never touch the backend", async () => {
  const { handleChatEditorRequest } = await import("@/lib/ai/editor/chat-edit");
  const sql = Array.from(
    { length: 5000 },
    (_, index) => `select id, total from orders_${index} where id > ${index};`,
  ).join("\n");
  const edits = Array.from({ length: 20 }, (_, index) => ({
    search: `select id, total from orders_${index * 250} where id > ${index * 250};`,
    replace: `select id, total, created_at\nfrom orders_${index * 250}\nwhere id > ${index * 250}\nlimit 100;`,
  }));
  let text = sql;
  let applied = 0;
  const controller = {
    text: () => text,
    chatEdit: async (next: string) => {
      applied++;
      text = next;
      return "";
    },
    getSession: () => ({ getSnapshot: () => ({ pending: 20 }) }),
  };
  const target = {
    controller: controller as never,
    title: "Perf",
    storedSql: sql,
    openTab: () => {},
  };
  const before = invokeCalls.length;
  const durations: number[] = [];
  for (let run = 0; run < 21; run++) {
    text = sql;
    const start = performance.now();
    const answer = await handleChatEditorRequest({ action: "edit", edits }, target);
    durations.push(performance.now() - start);
    expect(answer.ok).toBe(true);
  }
  const edit = percentiles(durations.slice(1));
  const readDurations: number[] = [];
  let readLength = 0;
  for (let run = 0; run < 21; run++) {
    const start = performance.now();
    readLength = (await handleChatEditorRequest({ action: "read" }, target)).text.length;
    readDurations.push(performance.now() - start);
  }
  const read = percentiles(readDurations.slice(1));
  await reportScenario("ai-chat-editor-edit", {
    statements: 5000,
    chars: sql.length,
    blocks: edits.length,
    edit,
    read,
    readChars: readLength,
    backendRequests: invokeCalls.length - before,
  });
  expect(applied).toBe(21);
  expect(text.split("\n")).toHaveLength(5000 + 60);
  expect(readLength).toBeLessThan(40_200);
  expect(invokeCalls.length - before).toBe(0);
  expect(edit.medianMs).toBeLessThan(40);
  expect(edit.p95Ms).toBeLessThan(80);
  expect(read.p95Ms).toBeLessThan(10);
});
