import { expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { reportScenario } from "../scripts/performance-report";

const invokes: string[] = [];
let pending: ((error: Error) => void) | null = null;
let replyText = "";

mock.module("@tauri-apps/api/core", () => ({
  transformCallback: () => 1,
  Channel: class {
    onmessage = () => {};
  },
  invoke: async (command: string) => {
    invokes.push(command);
    if (command === "ai_complete") {
      if (replyText === "__hang__")
        return new Promise((_resolve, reject) => {
          pending = reject;
        });
      return { text: replyText, truncated: false, model: "mock" };
    }
    if (command === "ai_complete_cancel") pending?.(new Error("Abgebrochen"));
    return [];
  },
}));

const { analyzeQuickFilter } = await import("@/lib/filter-quick-input");
const { filterAiRequest } = await import("@/lib/filter-ai/prompt");
const { parseFilterAiResponse } = await import("@/lib/filter-ai/parse");
const { filterAiChanges } = await import("@/lib/filter-ai/changes");
const { runFilterAi } = await import("@/lib/filter-ai/run");
const { FilterOmnibar } = await import("@/features/table/filter-bar/filter-omnibar");
const { FilterConditionTokens } = await import(
  "@/features/table/filter-bar/filter-condition-tokens"
);
const { FilterRuleTokens } = await import("@/features/table/filter-bar/filter-rule-tokens");
const { FilterPillBar } = await import("@/features/table/filter-bar/filter-pill-bar");
const { FALLBACK_PROVIDERS, useProvidersStore } = await import("@/lib/providers");
const { useConnectionsStore } = await import("@/lib/connections");

import type { FilterBarModel } from "@/features/table/filter-bar/use-filter-bar-model";
import type { FilterAiContext } from "@/lib/filter-ai/types";
import type { FilterCondition, RowRule } from "@/lib/table-view-state";

useProvidersStore.setState({ providers: FALLBACK_PROVIDERS, loaded: true });
useConnectionsStore.setState({
  activeId: "perf",
  connections: [
    {
      id: "perf",
      name: "perf",
      kind: "postgres",
      connectionString: "postgresql://localhost/perf",
      sslMode: "disable",
    },
  ],
});

const COLUMNS = Array.from({ length: 5_000 }, (_, index) =>
  index % 10 === 0 ? `status_${index}` : `column_${index}`,
);
const DETAILS = COLUMNS.map((name, index) => ({
  name,
  data_type: index % 3 === 0 ? "timestamptz" : index % 3 === 1 ? "text" : "int4",
}));

function percentiles(durations: number[]) {
  const sorted = [...durations].sort((left, right) => left - right);
  return {
    runs: sorted.length,
    medianMs: Number(sorted[Math.floor(sorted.length / 2)].toFixed(3)),
    p95Ms: Number(sorted[Math.ceil(sorted.length * 0.95) - 1].toFixed(3)),
  };
}

function measure(run: () => void, runs = 40) {
  run();
  const durations: number[] = [];
  for (let index = 0; index < runs; index++) {
    const started = performance.now();
    run();
    durations.push(performance.now() - started);
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

const conditions: FilterCondition[] = Array.from({ length: 25 }, (_, index) => ({
  id: `c${index}`,
  column: COLUMNS[index],
  operator: index % 2 ? "gt" : "in",
  value: index % 2 ? String(index) : JSON.stringify(["a", "b", "c"]),
}));
const rules: RowRule[] = Array.from({ length: 12 }, (_, index) => ({
  id: `r${index}`,
  color: "#ef4444",
  combinator: "AND",
  conditions: conditions.slice(index, index + 2),
}));

function context(patch: Partial<FilterAiContext> = {}): FilterAiContext {
  return {
    kind: "postgres",
    json: false,
    mode: "simple",
    columns: COLUMNS,
    columnDetails: DETAILS,
    conditions,
    combinator: "AND",
    sql: "",
    rules,
    today: "2026-10-17",
    ...patch,
  };
}

test("omnibar keystroke analysis stays fast on 5000 columns", async () => {
  const typed = "column_4999 = 'x' AND status_10 > 5 AND colu";
  let suggestions = 0;
  const keystroke = measure(() => {
    for (let length = 1; length <= typed.length; length += 8)
      suggestions = analyzeQuickFilter(typed.slice(0, length), COLUMNS, "postgres").suggestions
        .length;
  });
  const longText = measure(() => {
    analyzeQuickFilter("x".repeat(2_000), COLUMNS, "postgres");
  });
  await reportScenario("filter-bar-quick-input", {
    columns: COLUMNS.length,
    keystrokesPerRun: Math.ceil(typed.length / 8),
    keystroke,
    longText,
    suggestions,
  });
  expect(suggestions).toBeLessThanOrEqual(6);
  expect(keystroke.medianMs).toBeLessThan(15);
  expect(keystroke.p95Ms).toBeLessThan(40);
  expect(longText.medianMs).toBeLessThan(10);
});

test("AI prompt and response handling are bounded for huge schemas and answers", async () => {
  let promptChars = 0;
  const prompt = measure(() => {
    const request = filterAiRequest(context(), "z".repeat(10_000));
    promptChars = request.system.length + request.cached.length + request.messages[0].text.length;
  });
  const answer = JSON.stringify({
    filters: Array.from({ length: 400 }, (_, index) => ({
      column: COLUMNS[index],
      operator: "in",
      value: Array.from({ length: 50 }, (_, item) => `v${item}`),
    })),
    rules: Array.from({ length: 200 }, (_, index) => ({
      color: "blue",
      conditions: [{ column: COLUMNS[index], operator: "gt", value: index }],
    })),
    note: "n".repeat(10_000),
  });
  let kept = 0;
  const parse = measure(() => {
    const proposal = parseFilterAiResponse(answer, context());
    kept = (proposal.conditions?.length ?? 0) + (proposal.rules?.length ?? 0);
  }, 20);
  const proposal = parseFilterAiResponse(answer, context());
  const changes = measure(() => {
    filterAiChanges(context(), proposal);
  });
  retainedBytes(() => {
    for (let index = 0; index < 50; index++) parseFilterAiResponse(answer, context());
  });
  const retained = retainedBytes(() => {
    for (let index = 0; index < 50; index++) parseFilterAiResponse(answer, context());
  });
  await reportScenario("filter-bar-ai-bounds", {
    answerChars: answer.length,
    promptChars,
    prompt,
    parse,
    changes,
    kept,
    retainedBytesAfter50Parses: retained,
  });
  expect(promptChars).toBeLessThan(20_000);
  expect(kept).toBe(25 + 12);
  expect(prompt.medianMs).toBeLessThan(10);
  expect(parse.medianMs).toBeLessThan(60);
  expect(parse.p95Ms).toBeLessThan(150);
  expect(changes.medianMs).toBeLessThan(5);
  expect(retained).toBeLessThan(12_000_000);
});

test("one request per question, cancellation stops it and idle bars send nothing", async () => {
  invokes.length = 0;
  const props = {
    stateKey: "perf",
    columns: COLUMNS.slice(0, 200),
    columnDetails: DETAILS.slice(0, 200).map((column, index) => ({
      ...column,
      is_nullable: true,
      column_default: null,
      is_primary_key: false,
      ordinal_position: index,
      character_maximum_length: null,
    })),
    activeFilter: "",
    onApply: () => {},
  };
  const model = {
    columns: props.columns,
    columnDetails: props.columnDetails,
    conditions,
    combinator: "AND",
    orSupported: true,
    rules,
  } as unknown as FilterBarModel;
  let empty = "";
  let tokens = { chip: "", pill: "" };
  const bars = measure(() => {
    empty =
      renderToStaticMarkup(createElement(FilterOmnibar, props)) +
      renderToStaticMarkup(createElement(FilterPillBar, props));
  }, 20);
  const render = measure(() => {
    tokens = {
      chip: renderToStaticMarkup(
        createElement("div", null, [
          createElement(FilterConditionTokens, { key: "c", model, variant: "chip" }),
          createElement(FilterRuleTokens, { key: "r", model, variant: "chip", showLabel: false }),
        ]),
      ),
      pill: renderToStaticMarkup(
        createElement("div", null, [
          createElement(FilterConditionTokens, { key: "c", model, variant: "pill" }),
          createElement(FilterRuleTokens, { key: "r", model, variant: "pill", showLabel: false }),
        ]),
      ),
    };
  }, 20);
  expect(invokes.filter((command) => command.startsWith("ai_"))).toEqual([]);

  replyText = '{"filters":[{"column":"column_1","operator":"gt","value":1}]}';
  const answered = await runFilterAi(context({ conditions: [], rules: [] }), "nur column_1 > 1");
  expect(answered.conditions).toHaveLength(1);
  expect(invokes.filter((command) => command === "ai_complete")).toHaveLength(1);

  replyText = "__hang__";
  const controller = new AbortController();
  const running = runFilterAi(context(), "hängt", controller.signal).catch((error: Error) => error);
  await Bun.sleep(5);
  controller.abort();
  const outcome = await running;
  expect(outcome).toBeInstanceOf(Error);
  expect(invokes.filter((command) => command === "ai_complete")).toHaveLength(2);
  expect(invokes.filter((command) => command === "ai_complete_cancel")).toHaveLength(1);
  const settled = invokes.length;
  await Bun.sleep(20);
  expect(invokes.length).toBe(settled);

  await reportScenario("filter-bar-render-requests", {
    conditions: conditions.length,
    rules: rules.length,
    bars,
    render,
    emptyBarChars: empty.length,
    chipChars: tokens.chip.length,
    pillChars: tokens.pill.length,
    aiRequests: invokes.filter((command) => command === "ai_complete").length,
    cancels: invokes.filter((command) => command === "ai_complete_cancel").length,
  });
  expect(empty).toContain("Filter eingeben oder KI fragen");
  expect(empty).toContain("Filter hinzufügen");
  expect((tokens.chip.match(/data-filter-token=/g) ?? []).length).toBe(37);
  expect((tokens.pill.match(/data-filter-token=/g) ?? []).length).toBe(37);
  expect((tokens.pill.match(/<button/g) ?? []).length).toBeLessThan(200);
  expect(tokens.chip.length + tokens.pill.length).toBeLessThan(120_000);
  expect(bars.medianMs).toBeLessThan(20);
  expect(render.medianMs).toBeLessThan(40);
});

test("filter value inputs load the date picker only when a date value is edited", () => {
  const imports = new Bun.Transpiler({ loader: "tsx" }).scanImports(
    readFileSync(
      resolve(import.meta.dir, "../src/features/filters/filter-value-input.tsx"),
      "utf8",
    ),
  );
  expect(imports.find((entry) => entry.path === "./date-filter-input")?.kind).toBe(
    "dynamic-import",
  );
});
