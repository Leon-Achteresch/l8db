import type { ExplainNode } from "@/lib/db/rows";
import { normalizeExplainResult } from "@/lib/explain-normalize";

const STATS_SAMPLE = 10_000;

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff;
}

function cutAt(text: string, index: number): number {
  return index > 0 && index < text.length && isLowSurrogate(text.charCodeAt(index))
    ? index - 1
    : index;
}

function binaryLength(value: unknown): number | null {
  if (value instanceof Uint8Array) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return null;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean")
    return String(value);
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? "Invalid Date" : value.toISOString();
  const bytes = binaryLength(value);
  if (bytes !== null) return `<binary ${bytes} bytes>`;
  try {
    const json = JSON.stringify(value, (_key, inner) =>
      typeof inner === "bigint" ? inner.toString() : inner,
    );
    return json ?? String(value);
  } catch {
    return String(value);
  }
}

export function truncateValue(value: unknown, max = 80): string {
  const text = stringify(value);
  const limit = Math.max(0, max);
  if (text.length <= limit) return text;
  const cut = cutAt(text, limit);
  return `${text.slice(0, cut)}…(+${text.length - cut} chars)`;
}

type ValueKind = "int" | "number" | "bool" | "date" | "text" | "json" | "binary";

const KINDS: ValueKind[] = ["int", "number", "bool", "date", "text", "json", "binary"];
const INT = 0;
const NUMBER = 1;
const BOOL = 2;
const DATE = 3;
const TEXT = 4;
const JSON_KIND = 5;
const BINARY = 6;

const INT_TEXT = /^-?\d{1,30}$/;
const NUMBER_TEXT = /^-?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;
const DATE_TEXT = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$/;

function stringKind(value: string): number {
  if (value.length === 0 || value.length > 40) return TEXT;
  const first = value.charCodeAt(0);
  if (!((first >= 48 && first <= 57) || first === 45 || first === 46)) return TEXT;
  if (INT_TEXT.test(value)) return INT;
  if (NUMBER_TEXT.test(value)) return NUMBER;
  if (DATE_TEXT.test(value)) return DATE;
  return TEXT;
}

function kindOf(value: unknown): number {
  switch (typeof value) {
    case "number":
      return Number.isInteger(value) ? INT : NUMBER;
    case "bigint":
      return INT;
    case "boolean":
      return BOOL;
    case "string":
      return stringKind(value);
    default:
      if (value instanceof Date) return DATE;
      if (binaryLength(value) !== null) return BINARY;
      return JSON_KIND;
  }
}

function numericValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  return Number(value);
}

function dateValue(value: unknown): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function distinctKey(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return `d:${value.getTime()}`;
  const bytes = binaryLength(value);
  if (bytes !== null) return value;
  return `j:${stringify(value)}`;
}

function sampleIndexes(total: number): number[] {
  if (total <= STATS_SAMPLE) return Array.from({ length: total }, (_, index) => index);
  return Array.from({ length: STATS_SAMPLE }, (_, index) =>
    Math.floor((index * total) / STATS_SAMPLE),
  );
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (Number.isInteger(value)) return String(value);
  const abs = Math.abs(value);
  return abs >= 100 ? value.toFixed(0) : String(Number(value.toPrecision(4)));
}

function percent(part: number, total: number): string {
  if (total === 0 || part === 0) return "0%";
  const share = (part / total) * 100;
  return share < 1 ? "<1%" : `${Math.round(share)}%`;
}

function tsvCell(value: unknown, max: number): string {
  return truncateValue(value, max).replace(/[\t\r\n]+/g, " ");
}

export function compactResult(
  result: {
    columns: string[];
    rows: Record<string, unknown>[];
    totalRows?: number | null;
    truncated?: boolean;
  },
  options: { sampleRows?: number; maxCell?: number; includeValues?: boolean } = {},
): string {
  const { columns, rows } = result;
  const includeValues = options.includeValues === true;
  const sampleRows = Math.max(0, options.sampleRows ?? 8);
  const maxCell = Math.max(1, options.maxCell ?? 80);
  const header = [`${rows.length} Zeilen`];
  if (result.totalRows != null && result.totalRows !== rows.length)
    header[0] += ` von ${result.totalRows}`;
  header.push(`${columns.length} Spalten`);
  if (result.truncated) header.push("gekürzt");
  const lines = [header.join(", ")];
  const indexes = sampleIndexes(rows.length);
  const sampled = indexes.length < rows.length;
  const approx = sampled ? "~" : "";
  const stats = columns.map(() => ({
    nulls: 0,
    kinds: 0,
    distinct: new Set<unknown>(),
    minNumber: Number.POSITIVE_INFINITY,
    maxNumber: Number.NEGATIVE_INFINITY,
    minDate: null as string | null,
    maxDate: null as string | null,
    minLength: Number.POSITIVE_INFINITY,
    maxLength: 0,
  }));
  for (const index of indexes) {
    const row = rows[index];
    for (let position = 0; position < columns.length; position++) {
      const stat = stats[position];
      const value = row?.[columns[position]];
      if (value === null || value === undefined) {
        stat.nulls++;
        continue;
      }
      const kind = kindOf(value);
      stat.kinds |= 1 << kind;
      stat.distinct.add(kind === JSON_KIND || kind === DATE ? distinctKey(value) : value);
      if (kind === INT || kind === NUMBER) {
        const number = numericValue(value);
        if (number < stat.minNumber) stat.minNumber = number;
        if (number > stat.maxNumber) stat.maxNumber = number;
      } else if (kind === DATE) {
        if (!includeValues) continue;
        const text = dateValue(value);
        if (stat.minDate === null || text < stat.minDate) stat.minDate = text;
        if (stat.maxDate === null || text > stat.maxDate) stat.maxDate = text;
      } else if (kind === TEXT) {
        const length = (value as string).length;
        if (length < stat.minLength) stat.minLength = length;
        if (length > stat.maxLength) stat.maxLength = length;
      }
    }
  }
  for (const [position, column] of columns.entries()) {
    const stat = stats[position];
    const nonNull = indexes.length - stat.nulls;
    const present = KINDS.filter((_, kind) => stat.kinds & (1 << kind));
    let type: string;
    if (present.length === 0) type = "null";
    else if (present.length === 1) type = present[0];
    else if (stat.kinds === ((1 << INT) | (1 << NUMBER))) type = "number";
    else type = "mixed";
    const parts = [`${column}: ${type}`];
    if (stat.nulls > 0) parts.push(`${approx}${percent(stat.nulls, indexes.length)} NULL`);
    if (nonNull > 0) {
      const unique = stat.distinct.size === nonNull && !sampled ? " (unique)" : "";
      parts.push(`${sampled ? "≥" : ""}${stat.distinct.size} distinct${unique}`);
    }
    if (stat.kinds & (1 << TEXT) && stat.maxLength > 0) {
      parts.push(
        stat.minLength === stat.maxLength
          ? `len ${stat.minLength}`
          : `len ${stat.minLength}–${stat.maxLength}`,
      );
    }
    if (includeValues) {
      if ((type === "int" || type === "number") && Number.isFinite(stat.minNumber)) {
        parts.push(`${formatNumber(stat.minNumber)}…${formatNumber(stat.maxNumber)}`);
      } else if (type === "date" && stat.minDate !== null) {
        parts.push(
          `${truncateValue(stat.minDate, maxCell)}…${truncateValue(stat.maxDate, maxCell)}`,
        );
      }
    }
    lines.push(`- ${parts.join(", ")}`);
  }
  if (includeValues && sampleRows > 0 && rows.length > 0 && columns.length > 0) {
    const shown = Math.min(sampleRows, rows.length);
    lines.push(`Beispielzeilen (${shown}):`);
    lines.push(columns.map((column) => tsvCell(column, maxCell)).join("\t"));
    for (let index = 0; index < shown; index++) {
      const row = rows[index];
      lines.push(columns.map((column) => tsvCell(row?.[column], maxCell)).join("\t"));
    }
  }
  return lines.join("\n");
}

type PlanNode = Partial<ExplainNode> & Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function shortText(value: unknown, max = 160): string | undefined {
  if (typeof value === "string" && value.trim()) return truncateValue(value.trim(), max);
  if (Array.isArray(value) && value.length) return truncateValue(value.join(", "), max);
  return undefined;
}

function nodeTime(node: PlanNode): number | undefined {
  const time = finite(node["Actual Total Time"]);
  if (time === undefined) return undefined;
  return time * (finite(node["Actual Loops"]) ?? 1);
}

function planLine(node: PlanNode): string {
  const parts: string[] = [String(node["Node Type"] ?? "?")];
  const join = shortText(node["Join Type"], 20);
  if (join && join !== "Inner") parts[0] += ` (${join})`;
  const relation = shortText(node["Relation Name"], 80);
  if (relation) {
    const schema = shortText(node.Schema, 40);
    const alias = shortText(node.Alias, 40);
    parts.push(
      `on ${schema ? `${schema}.` : ""}${relation}${alias && alias !== relation ? ` ${alias}` : ""}`,
    );
  }
  const indexName = shortText(node["Index Name"], 80);
  if (indexName) parts.push(`[${indexName}]`);
  const cost = finite(node["Total Cost"]);
  if (cost !== undefined) parts.push(`cost=${formatNumber(cost)}`);
  const estimate = finite(node["Plan Rows"]);
  const actual = finite(node["Actual Rows"]);
  if (estimate !== undefined && actual !== undefined) {
    const ratio = Math.max(actual, 1) / Math.max(estimate, 1);
    parts.push(
      `rows ${formatNumber(estimate)}→${formatNumber(actual)}${ratio >= 10 || ratio <= 0.1 ? " !rows" : ""}`,
    );
  } else if (estimate !== undefined) parts.push(`rows ${formatNumber(estimate)}`);
  else if (actual !== undefined) parts.push(`rows →${formatNumber(actual)}`);
  const loops = finite(node["Actual Loops"]);
  if (loops !== undefined && loops > 1) parts.push(`loops=${formatNumber(loops)}`);
  const time = finite(node["Actual Total Time"]);
  if (time !== undefined) parts.push(`time=${formatNumber(time)}ms`);
  for (const [key, label] of [
    ["Index Cond", "cond"],
    ["Hash Cond", "cond"],
    ["Merge Cond", "cond"],
    ["Join Filter", "join"],
    ["Filter", "filter"],
    ["Sort Key", "sort"],
    ["Group Key", "group"],
  ] as const) {
    const value = shortText(node[key]);
    if (value) parts.push(`${label}=${value}`);
  }
  const removed = finite(node["Rows Removed by Filter"]);
  if (removed) parts.push(`removed=${formatNumber(removed)}`);
  return parts.join(" ");
}

function fallbackJson(plan: unknown): string {
  let text: string;
  try {
    text = typeof plan === "string" ? plan : (JSON.stringify(plan) ?? String(plan));
  } catch {
    text = String(plan);
  }
  return text.length > 4000 ? `${text.slice(0, cutAt(text, 4000))}…` : text;
}

export function compactExplain(
  plan: unknown,
  options: { maxNodes?: number; minShare?: number } = {},
): string {
  const maxNodes = Math.max(1, options.maxNodes ?? 30);
  const minShare = Math.max(0, options.minShare ?? 0.02);
  let root: PlanNode | null = null;
  if (isRecord(plan) && typeof plan["Node Type"] === "string") root = plan as PlanNode;
  else {
    try {
      root = normalizeExplainResult(plan) as PlanNode | null;
    } catch {
      root = null;
    }
  }
  if (!root) return fallbackJson(plan);
  if (typeof root["Plan Text"] === "string" && !Array.isArray(root.Plans))
    return fallbackJson(root["Plan Text"]);
  const rootTime = nodeTime(root);
  const rootCost = finite(root["Total Cost"]);
  const useTime = rootTime !== undefined && rootTime > 0;
  const total = useTime ? (rootTime as number) : (rootCost ?? 0);
  const lines: string[] = [];
  let skipped = 0;
  let overflow = 0;
  const stack: { node: PlanNode; depth: number }[] = [{ node: root, depth: 0 }];
  while (stack.length) {
    const { node, depth } = stack.pop() as { node: PlanNode; depth: number };
    const children = Array.isArray(node.Plans) ? (node.Plans as PlanNode[]) : [];
    for (let index = children.length - 1; index >= 0; index--) {
      if (isRecord(children[index])) stack.push({ node: children[index], depth: depth + 1 });
    }
    const value = useTime ? nodeTime(node) : finite(node["Total Cost"]);
    const relevant = depth === 0 || total <= 0 || value === undefined || value / total >= minShare;
    if (!relevant) skipped++;
    else if (lines.length >= maxNodes) overflow++;
    else lines.push(`${"  ".repeat(Math.min(depth, 20))}${planLine(node)}`);
  }
  if (skipped) lines.push(`… ${skipped} Knoten unter ${formatNumber(minShare * 100)}% ausgelassen`);
  if (overflow) lines.push(`… ${overflow} weitere Knoten (Limit ${maxNodes})`);
  return lines.join("\n");
}

const STACK_LINE = /^\s*(at\s|\d+:\s+0x|stack backtrace:|Backtrace|\s*in\s+\S+\.rs:\d+)/;

export function compactError(
  sql: string,
  error: { message: string; code?: string | null; position?: number | null; line?: number | null },
  context = 2,
): string {
  const message = error.message
    .split(/\r?\n/)
    .filter((line) => line.trim() && !STACK_LINE.test(line))
    .join("\n");
  const cut = message.length > 600 ? `${message.slice(0, cutAt(message, 600))}…` : message;
  const out = [`Fehler${error.code ? ` [${error.code}]` : ""}: ${cut}`];
  const lines = sql.split(/\r?\n/);
  let lineNumber: number | null = null;
  let column: number | null = null;
  if (error.position != null && error.position >= 1) {
    const offset = Math.min(error.position - 1, sql.length);
    const lineStart = sql.lastIndexOf("\n", offset - 1) + 1;
    let count = 1;
    for (
      let index = sql.indexOf("\n");
      index >= 0 && index < lineStart;
      index = sql.indexOf("\n", index + 1)
    )
      count++;
    lineNumber = count;
    column = offset - lineStart + 1;
  } else if (error.line != null && error.line >= 1) {
    lineNumber = Math.min(error.line, lines.length);
  }
  if (lineNumber === null || !sql.trim()) return out.join("\n");
  const span = Math.max(0, context);
  const first = Math.max(1, lineNumber - span);
  const last = Math.min(lines.length, lineNumber + span);
  const width = String(last).length;
  for (let number = first; number <= last; number++) {
    let text = lines[number - 1];
    let caret = column;
    if (text.length > 240) {
      const center = number === lineNumber && caret !== null ? caret - 1 : 0;
      const from = Math.max(0, Math.min(center - 120, text.length - 240));
      text = `${from > 0 ? "…" : ""}${text.slice(from, from + 240)}${from + 240 < text.length ? "…" : ""}`;
      if (caret !== null) caret = caret - from + (from > 0 ? 1 : 0);
    }
    out.push(`${String(number).padStart(width)} | ${text}`);
    if (number === lineNumber && caret !== null) {
      out.push(`${" ".repeat(width)} | ${" ".repeat(Math.max(0, caret - 1))}^`);
    }
  }
  return out.join("\n");
}
