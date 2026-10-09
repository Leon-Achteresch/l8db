import { expect, test } from "bun:test";
import { compactResult } from "@/lib/ai/editor/compact";
import { compactHistory, type HistoryMessage } from "@/lib/ai/editor/history";
import { applyHunks, diffLines } from "@/lib/ai/editor/line-diff";
import { redactSecrets } from "@/lib/ai/editor/redact";
import {
  rankTables,
  relevantSchema,
  type SchemaSource,
  schemaContextStats,
  schemaOverview,
} from "@/lib/ai/editor/schema-context";
import type { ColumnInfo, ForeignKeyInfo, TableInfo } from "@/lib/db/types";
import { reportScenario } from "../scripts/performance-report";

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
  const durations: number[] = [];
  for (let index = 0; index < runs; index++) {
    const start = performance.now();
    run();
    durations.push(performance.now() - start);
  }
  return percentiles(durations);
}

function timeOnce(run: () => void) {
  const start = performance.now();
  run();
  return Number((performance.now() - start).toFixed(3));
}

function schema(): { source: SchemaSource; foreignKeys: ForeignKeyInfo[] } {
  const tables: TableInfo[] = [];
  const views: TableInfo[] = [];
  const columns: ColumnInfo[] = [];
  const types = ["integer", "bigint", "text", "character varying(255)", "timestamp with time zone"];
  for (let index = 0; index < 3000; index++) {
    const table = {
      schema: `schema_${index % 10}`,
      name: `entity_${String(index).padStart(4, "0")}_records`,
    };
    if (index % 15 === 0) views.push(table);
    else tables.push(table);
    for (let col = 0; col < 20; col++) {
      columns.push({
        schema: table.schema,
        table: table.name,
        name: col === 0 ? "id" : `field_${col}`,
        data_type: types[col % types.length],
      });
    }
  }
  const all = [...tables, ...views];
  const foreignKeys: ForeignKeyInfo[] = Array.from({ length: 2000 }, (_, index) => {
    const from = all[index % all.length];
    const to = all[(index * 7 + 13) % all.length];
    return {
      constraint_name: `fk_${index}`,
      from_schema: from.schema,
      from_table: from.name,
      from_column: `field_${(index % 19) + 1}`,
      to_schema: to.schema,
      to_table: to.name,
      to_column: "id",
    };
  });
  return { source: { tables, views, columns }, foreignKeys };
}

function bigSql(): string {
  const parts: string[] = [];
  let index = 0;
  while (parts.join("\n").length < 4096) {
    parts.push(
      `select a.id, b.field_3 from schema_${index % 10}.entity_${String(index * 37).padStart(4, "0")}_records a join entity_${String(index * 11 + 5).padStart(4, "0")}_records b on b.field_1 = a.id where a.field_2 = 'entity_0001_records'; -- note`,
    );
    index++;
  }
  return parts.join("\n").slice(0, 4096);
}

test("schema context stays within latency, size and cache budgets for 3000 tables", async () => {
  const { source, foreignKeys } = schema();
  const sql = bigSql();
  const prompt = "join the entity 0042 records with entity_0100_records and list recent rows";
  const recent = ["schema_2.entity_0002_records", "schema_3.entity_0003_records"];
  const buildsBefore = schemaContextStats().indexBuilds;
  const coldOverviewMs = timeOnce(() => schemaOverview(source, { defaultSchema: "schema_0" }));
  const coldRankMs = timeOnce(() =>
    rankTables(source, { sql, prompt, recent, foreignKeys, defaultSchema: "schema_0" }),
  );
  let ranked: TableInfo[] = [];
  const coldRelevantMs = timeOnce(() => {
    ranked = rankTables(source, { sql, prompt, recent, foreignKeys, defaultSchema: "schema_0" });
    relevantSchema(source, ranked, { foreignKeys, defaultSchema: "schema_0" });
  });
  const overview = measure(() => {
    const text = schemaOverview(source, { defaultSchema: "schema_0" });
    if (text.length > 6000) throw new Error("overview too long");
  });
  const overviewUncached = measure(() => {
    schemaOverview(source, { defaultSchema: "schema_0", maxChars: 6000 + Math.random() });
  });
  const rank = measure(() => {
    ranked = rankTables(source, { sql, prompt, recent, foreignKeys, defaultSchema: "schema_0" });
  });
  let relevantText = "";
  const relevant = measure(() => {
    relevantText = relevantSchema(source, ranked, { foreignKeys, defaultSchema: "schema_0" });
  });
  const builds = schemaContextStats().indexBuilds - buildsBefore;
  const fkBuildsBefore = schemaContextStats().fkBuilds;
  Bun.gc(true);
  const heapBefore = process.memoryUsage().heapUsed;
  for (let index = 0; index < 1000; index++) {
    rankTables(source, { sql, prompt, recent, foreignKeys, defaultSchema: "schema_0" });
  }
  Bun.gc(true);
  const retainedBytes = process.memoryUsage().heapUsed - heapBefore;
  const overviewText = schemaOverview(source, { defaultSchema: "schema_0" });
  await reportScenario("ai-editor-schema-context", {
    tables: source.tables.length,
    views: source.views.length,
    columns: source.columns.length,
    foreignKeys: foreignKeys.length,
    sqlChars: sql.length,
    coldOverviewMs,
    coldRankMs,
    coldRelevantMs,
    overview,
    overviewUncached,
    rank,
    relevant,
    rankedTables: ranked.length,
    overviewChars: overviewText.length,
    relevantChars: relevantText.length,
    indexBuilds: builds,
    retainedBytesAfter1000Calls: retainedBytes,
  });
  expect(builds).toBe(1);
  expect(schemaContextStats().fkBuilds).toBe(fkBuildsBefore);
  expect(retainedBytes).toBeLessThan(2_000_000);
  expect(ranked.length).toBe(12);
  expect(overviewText.length).toBeLessThanOrEqual(6000);
  expect(overviewText).toMatch(/… \+\d+ weitere Objekte$/);
  expect(relevantText.length).toBeLessThanOrEqual(4000);
  expect(coldOverviewMs + coldRankMs + coldRelevantMs).toBeLessThan(150);
  expect(overview.medianMs).toBeLessThan(0.5);
  expect(overviewUncached.medianMs).toBeLessThan(1);
  expect(overviewUncached.p95Ms).toBeLessThan(5);
  expect(rank.medianMs).toBeLessThan(2);
  expect(rank.p95Ms).toBeLessThan(10);
  expect(relevant.medianMs).toBeLessThan(2);
  expect(relevant.p95Ms).toBeLessThan(10);
});

test("diffLines handles 2000 lines with 5% changes", async () => {
  const a = Array.from({ length: 2000 }, (_, index) => `select ${index} as value_${index};`);
  const b = a.map((line, index) => (index % 20 === 7 ? `${line} -- changed` : line));
  b.splice(1000, 0, "select 'inserted';");
  const textA = a.join("\n");
  const textB = b.join("\n");
  let hunks = diffLines(textA, textB);
  const timing = measure(() => {
    hunks = diffLines(textA, textB);
  });
  const applyTiming = measure(() => {
    applyHunks(
      textA,
      hunks,
      hunks.map(() => true),
    );
  });
  await reportScenario("ai-editor-line-diff", {
    lines: 2000,
    hunks: hunks.length,
    diff: timing,
    apply: applyTiming,
  });
  expect(
    applyHunks(
      textA,
      hunks,
      hunks.map(() => true),
    ),
  ).toBe(textB);
  expect(hunks.length).toBe(101);
  expect(timing.medianMs).toBeLessThan(10);
  expect(applyTiming.medianMs).toBeLessThan(2);
});

test("compactResult summarises 200 000 rows x 12 columns", async () => {
  const columns = Array.from({ length: 12 }, (_, index) => `c${index}`);
  const rows = Array.from({ length: 200_000 }, (_, row) => {
    const record: Record<string, unknown> = {};
    for (const [index, column] of columns.entries()) {
      const kind = index % 4;
      record[column] =
        row % 13 === index
          ? null
          : kind === 0
            ? row
            : kind === 1
              ? `name ${row % 5000}`
              : kind === 2
                ? row * 0.5
                : `2024-01-${String((row % 28) + 1).padStart(2, "0")}`;
    }
    return record;
  });
  let text = "";
  const timing = measure(() => {
    text = compactResult({ columns, rows, totalRows: 200_000 });
  }, 30);
  const withValues = measure(() => {
    compactResult({ columns, rows }, { includeValues: true });
  }, 30);
  await reportScenario("ai-editor-compact-result", {
    rows: rows.length,
    columns: columns.length,
    chars: text.length,
    summary: timing,
    summaryWithValues: withValues,
  });
  expect(text.length).toBeLessThan(2000);
  expect(timing.medianMs).toBeLessThan(50);
  expect(withValues.medianMs).toBeLessThan(50);
});

test("redactSecrets scans 1 MB in linear time", async () => {
  const chunk =
    "SELECT id, email FROM users WHERE token = $1 AND note = 'postgres://u:pw@h/db password=abc'; -- ok\n";
  const input = chunk.repeat(Math.ceil(1_000_000 / chunk.length)).slice(0, 1_000_000);
  let output = "";
  const timing = measure(() => {
    output = redactSecrets(input);
  }, 30);
  await reportScenario("ai-editor-redact", { bytes: input.length, redact: timing });
  expect(output).not.toContain(":pw@");
  expect(timing.medianMs).toBeLessThan(50);
});

test("compactHistory compacts 200 messages of 2 KB", async () => {
  const messages: HistoryMessage[] = Array.from({ length: 200 }, (_, index) => ({
    role: index % 2 === 0 ? "user" : "assistant",
    text: `${index} ${"x".repeat(2048)}`,
  }));
  let result = compactHistory(messages);
  const timing = measure(() => {
    result = compactHistory(messages, { summary: { count: 100, text: "Zusammenfassung" } });
  });
  await reportScenario("ai-editor-history", {
    messages: messages.length,
    keptMessages: result.messages.length,
    compacted: result.compacted,
    chars: result.messages.reduce((sum, message) => sum + message.text.length, 0),
    history: timing,
  });
  expect(
    result.messages.reduce((sum, message) => sum + message.text.length, 0),
  ).toBeLessThanOrEqual(24_000);
  expect(timing.medianMs).toBeLessThan(1);
});
