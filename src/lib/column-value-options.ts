import type { ColumnValueOptions, ConstraintInfo, DetailedColumnInfo } from "@/lib/db";

type Token =
  | { type: "string"; value: string }
  | { type: "number"; value: string }
  | { type: "ident"; value: string }
  | { type: "word"; value: string }
  | { type: "punct"; value: string };

const KEYWORDS = new Set(["IN", "OR", "AND", "ANY", "ARRAY", "NOT", "CHECK"]);

function tokenize(source: string): Token[] | null {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "'") {
      let end = index + 1;
      let value = "";
      while (end < source.length) {
        if (source[end] === "'" && source[end + 1] === "'") {
          value += "'";
          end += 2;
          continue;
        }
        if (source[end] === "'") break;
        value += source[end];
        end += 1;
      }
      if (end >= source.length) return null;
      tokens.push({ type: "string", value });
      index = end + 1;
      continue;
    }
    if (char === '"' || char === "`") {
      const end = source.indexOf(char, index + 1);
      if (end < 0) return null;
      tokens.push({ type: "ident", value: source.slice(index + 1, end) });
      index = end + 1;
      continue;
    }
    const previous = tokens[tokens.length - 1];
    if (char === "[" && !(previous?.type === "word" && previous.value === "ARRAY")) {
      const end = source.indexOf("]", index + 1);
      if (end > index + 1) {
        tokens.push({ type: "ident", value: source.slice(index + 1, end) });
        index = end + 1;
        continue;
      }
    }
    const number = /^-?\d+(?:\.\d+)?/.exec(source.slice(index));
    if (number && !(previous && (previous.type === "ident" || previous.type === "number"))) {
      tokens.push({ type: "number", value: number[0] });
      index += number[0].length;
      continue;
    }
    if (source.startsWith("::", index)) {
      tokens.push({ type: "punct", value: "::" });
      index += 2;
      continue;
    }
    const word = /^[A-Za-z_][\w$]*/.exec(source.slice(index));
    if (word) {
      const upper = word[0].toUpperCase();
      tokens.push(
        KEYWORDS.has(upper) ? { type: "word", value: upper } : { type: "ident", value: word[0] },
      );
      index += word[0].length;
      continue;
    }
    tokens.push({ type: "punct", value: char });
    index += 1;
  }
  return tokens;
}

function stripCastsAndParens(tokens: Token[]): Token[] {
  const out: Token[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === "punct" && token.value === "::") {
      while (tokens[index + 1]?.type === "ident") index += 1;
      if (tokens[index + 1]?.value === "[" && tokens[index + 2]?.value === "]") index += 2;
      continue;
    }
    if (token.type === "punct" && (token.value === "(" || token.value === ")")) continue;
    out.push(token);
  }
  return out;
}

function literalList(tokens: Token[], start: number, end: number): string[] | null {
  const values: string[] = [];
  for (let index = start; index < end; index += 1) {
    const token = tokens[index];
    const expectValue = (index - start) % 2 === 0;
    if (expectValue) {
      if (token.type !== "string" && token.type !== "number") return null;
      values.push(token.value);
    } else if (token.value !== ",") return null;
  }
  return values.length > 0 && (end - start) % 2 === 1 ? values : null;
}

export function parseCheckValues(definition: string): { column: string; values: string[] } | null {
  const normalized = definition
    .trim()
    .replace(/\\'/g, "'")
    .replace(/(^|[\s,(=])_[a-z][a-z0-9]*'/gi, "$1'")
    .replace(/(^|[\s,(=])N'/g, "$1'");
  const raw = tokenize(normalized);
  if (!raw) return null;
  const tokens = stripCastsAndParens(raw).filter(
    (token, index) => !(index === 0 && token.type === "word" && token.value === "CHECK"),
  );
  const [first, second] = tokens;
  if (first?.type !== "ident") return null;
  if (second?.type === "word" && second.value === "IN") {
    const values = literalList(tokens, 2, tokens.length);
    return values ? { column: first.value, values } : null;
  }
  if (
    second?.value === "=" &&
    tokens[2]?.value === "ANY" &&
    tokens[3]?.value === "ARRAY" &&
    tokens[4]?.value === "[" &&
    tokens[tokens.length - 1]?.value === "]"
  ) {
    const values = literalList(tokens, 5, tokens.length - 1);
    return values ? { column: first.value, values } : null;
  }
  if (second?.value === "=") {
    const values: string[] = [];
    for (let index = 0; index < tokens.length; index += 4) {
      const [ident, eq, literal, separator] = tokens.slice(index, index + 4);
      if (ident?.type !== "ident" || ident.value !== first.value || eq?.value !== "=") return null;
      if (literal?.type !== "string" && literal?.type !== "number") return null;
      values.push(literal.value);
      if (separator && separator.value !== "OR") return null;
    }
    return values.length > 1 ? { column: first.value, values } : null;
  }
  return null;
}

export function parseEnumTypeValues(dataType: string): string[] | null {
  const match = /^\s*enum\s*\((.*)\)\s*$/i.exec(dataType);
  if (!match) return null;
  const tokens = tokenize(match[1]);
  if (!tokens) return null;
  return literalList(tokens, 0, tokens.length);
}

export function buildColumnValueOptions(
  columns: DetailedColumnInfo[] | undefined,
  constraints: ConstraintInfo[] | undefined,
  enumColumns: ColumnValueOptions[] | undefined,
): Record<string, string[]> {
  const options: Record<string, string[]> = {};
  const names = (columns ?? []).map((column) => column.name);
  const resolve = (name: string) =>
    names.find((column) => column === name) ??
    names.find((column) => column.toLowerCase() === name.toLowerCase());
  for (const constraint of constraints ?? []) {
    if (constraint.constraint_type.toUpperCase() !== "CHECK") continue;
    const parsed = parseCheckValues(constraint.definition);
    if (!parsed) continue;
    const column = resolve(parsed.column);
    if (column) options[column] = parsed.values;
  }
  for (const column of columns ?? []) {
    const values = parseEnumTypeValues(column.data_type);
    if (values) options[column.name] = values;
  }
  for (const entry of enumColumns ?? []) {
    if (entry.values.length > 0) options[entry.column] = entry.values;
  }
  return options;
}
