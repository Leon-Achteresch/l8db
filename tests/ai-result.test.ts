import { expect, test } from "bun:test";
import { aiSuggestions } from "@/lib/ai/prompts";
import {
  aiChartConfig,
  aiFollowups,
  aiThreadMarkdown,
  parseAiTable,
  stripAiFollowups,
} from "@/lib/ai/result";
import { mergeAiRich, normalizeAiRich, sanitizeAiRich } from "@/lib/ai/rich";

const tsv = "month\trevenue\n2026-01-01\t120.5\n2026-02-01\tNULL\n(2 rows, 1 cells redacted)";

test("MCP query TSV becomes a table and other tool output does not", () => {
  const table = parseAiTable(tsv);
  expect(table?.columns).toEqual(["month", "revenue"]);
  expect(table?.rows).toEqual([
    { month: "2026-01-01", revenue: "120.5" },
    { month: "2026-02-01", revenue: null },
  ]);
  expect(table?.footer).toBe("2 rows, 1 cells redacted");
  expect(parseAiTable("ok, 3 rows affected")).toBeNull();
  expect(parseAiTable("public.orders(id int)")).toBeNull();
});

test("the model's chart choice is kept and invalid axes fall back to a suggestion", () => {
  const table = parseAiTable(tsv);
  if (!table) throw new Error("table");
  const bars = aiChartConfig({ chart: "bars", x: "month", y: ["revenue"] }, table);
  expect(bars).toMatchObject({ chart: "bars", x: "month", y: ["revenue"] });
  const guessed = aiChartConfig({ chart: "line", x: "missing" }, table);
  expect(guessed).toMatchObject({ chart: "line", x: "month", y: ["revenue"], sort: "x_asc" });
});

test("visualize tool events keep SQL and chart spec after the completion event", () => {
  const running = normalizeAiRich({
    kind: "tool",
    data: {
      id: "t1",
      name: "visualize",
      status: "running",
      arguments: { sql: "select 1", chart: "donut", title: "Anteile", y: ["n"], password: "x" },
    },
  });
  const done = normalizeAiRich({
    kind: "tool",
    data: {
      id: "t1",
      name: "visualize",
      status: "completed",
      result: { content: [{ type: "text", text: tsv }] },
    },
  });
  const [merged] = sanitizeAiRich(JSON.parse(JSON.stringify(mergeAiRich(running, done))));
  expect(merged).toMatchObject({
    type: "tool",
    status: "success",
    sql: "select 1",
    title: "Anteile",
    chart: { chart: "donut", y: ["n"] },
  });
  expect(JSON.stringify(merged)).not.toContain("password");
});

test("follow-up questions are parsed, hidden from copies and exports", () => {
  expect(aiFollowups("- Wie viele?\n2. Und warum?\n\n")).toEqual(["Wie viele?", "Und warum?"]);
  const text = "Umsatz stieg.\n\n```followups\nWarum?\n```";
  expect(stripAiFollowups(text)).toBe("Umsatz stieg.");
  const markdown = aiThreadMarkdown("Umsatz", [
    { role: "user", text: "Wie war der Umsatz?" },
    {
      role: "assistant",
      text,
      rich: [
        {
          type: "tool",
          id: "t",
          name: "visualize",
          status: "success",
          output: "",
          sql: "select 1",
          title: "Umsatz",
        },
      ],
    },
  ]);
  expect(markdown).toContain("```sql\nselect 1\n```");
  expect(markdown).not.toContain("followups");
});

test("example questions prefer business tables and skip system tables", () => {
  const questions = aiSuggestions(["pg_stat", "_migrations", "settings", "orders", "customers"]);
  expect(questions).toHaveLength(4);
  expect(questions[1]).toContain("orders");
  expect(questions[2]).toContain("customers");
  expect(questions.join(" ")).not.toContain("pg_stat");
  expect(aiSuggestions([])).toHaveLength(1);
});
