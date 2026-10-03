import type { ChartKind } from "@/lib/dashboards";
import type { AiMessage } from "@/lib/db/ai";
import { type ResultChartConfig, sanitizeConfig, suggestChart } from "@/lib/result-chart";

export interface AiTable {
  columns: string[];
  rows: Record<string, string | null>[];
  footer: string;
}

export interface AiChartSpec {
  chart?: string;
  x?: string;
  y?: string[];
  title?: string;
}

export function parseAiTable(output: string): AiTable | null {
  const lines = output.replace(/\n\[truncated at [^\n]*\]$/, "").split("\n");
  const footer = lines.at(-1) ?? "";
  if (lines.length < 2 || !/^\(\d+ rows/.test(footer)) return null;
  const columns = lines[0].split("\t");
  if (!columns.length || !columns[0]) return null;
  const rows = lines.slice(1, -1).map((line) => {
    const cells = line.split("\t");
    return Object.fromEntries(
      columns.map((column, index) => [
        column,
        cells[index] === undefined || cells[index] === "NULL" ? null : cells[index],
      ]),
    );
  });
  return { columns, rows, footer: footer.slice(1, -1) };
}

export function aiChartConfig(spec: AiChartSpec, table: AiTable): ResultChartConfig {
  const suggested = suggestChart(table.columns, table.rows);
  const has = (column?: string) => Boolean(column && table.columns.includes(column));
  const chart = (spec.chart || suggested.chart) as ChartKind;
  const x = has(spec.x) ? (spec.x ?? null) : suggested.x;
  const y = (spec.y ?? []).filter((column) => has(column));
  return sanitizeConfig(
    {
      ...suggested,
      chart,
      x,
      y: y.length ? y : suggested.y.filter((column) => column !== x),
      agg: x === suggested.x ? suggested.agg : "none",
      sort: chart === "line" || chart === "area" ? "x_asc" : suggested.sort,
    },
    table.columns,
  );
}

export function aiFollowups(code: string): string[] {
  return code
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

export function stripAiFollowups(text: string): string {
  return text.replace(/```followups\n[\s\S]*?(?:```|$)/g, "").trimEnd();
}

export function aiThreadMarkdown(title: string, messages: AiMessage[]): string {
  const parts = [`# ${title}`];
  for (const message of messages) {
    parts.push(message.role === "user" ? "## Frage" : "## Antwort");
    for (const file of message.attachments ?? []) parts.push(`Anhang: ${file.name}`);
    for (const block of message.rich ?? []) {
      if (block.type !== "tool" || !block.sql) continue;
      parts.push(`${block.title || block.name}:\n\n\`\`\`sql\n${block.sql}\n\`\`\``);
    }
    const text = stripAiFollowups(message.text);
    if (text) parts.push(text);
    if (message.error) parts.push(`> Fehler: ${message.error}`);
  }
  return `${parts.join("\n\n")}\n`;
}
