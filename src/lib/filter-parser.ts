import { type FilterKind, type FilterOperatorKey, filterOperatorsForKind } from "@/lib/sql-filter";

export interface ParsedFilterCondition {
  column: string;
  operator: FilterOperatorKey;
  value: string;
  dataType?: string;
}

export interface ParsedFilter {
  conditions: ParsedFilterCondition[];
  combinator: "AND" | "OR";
}

type Token = {
  kind: "word" | "identifier" | "string" | "number" | "bare" | "symbol";
  value: string;
  at: number;
  end?: number;
  normalized?: string;
};
type Group = { combinator: "AND" | "OR"; children: Node[] };
type Node = ParsedFilterCondition | Group;

function fail(message: string, at: number): never {
  throw new Error(`${message} (Position ${at + 1}).`);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    if (/\s/.test(source[at])) {
      at++;
      continue;
    }
    const start = at;
    const quote = source[at];
    const smartQuote = ["‚", "‘", "’"].includes(quote);
    if (smartQuote || ["'", '"', "`", "["].includes(quote)) {
      const close = quote === "[" ? "]" : quote;
      let value = "";
      let closed = false;
      at++;
      while (at < source.length) {
        const character = source[at];
        const closes = smartQuote
          ? ["'", "‘", "’"].includes(character) &&
            (!/[\p{L}\p{N}]/u.test(source[at + 1] ?? "") || source[at + 1] === character)
          : character === close;
        if (closes) {
          if (source[at + 1] === character) {
            value += character;
            at += 2;
          } else {
            at++;
            closed = true;
            break;
          }
        } else value += source[at++];
      }
      if (!closed) fail("Anführungszeichen nicht geschlossen", start);
      tokens.push({
        kind: smartQuote || quote === "'" ? "string" : "identifier",
        value,
        at: start,
        end: at,
        ...(smartQuote ? { normalized: `'${value.replace(/'/g, "''")}'` } : {}),
      });
      continue;
    }
    const symbol = source.slice(at).match(/^(?:>=|<=|<>|!=|[=><(),])/);
    const bare = source.slice(at).match(/^[^\s'"`[\](),;=<>!]+/);
    const match = symbol ?? bare;
    if (!match) fail(`Unerwartetes Zeichen „${source[at]}“`, at);
    const text = match[0];
    if (text.startsWith("--") || text.startsWith("/*")) fail("Kommentare sind nicht erlaubt", at);
    const kind = symbol
      ? "symbol"
      : /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text)
        ? "number"
        : /^[\p{L}_][\p{L}\p{N}_$]*$/u.test(text)
          ? "word"
          : "bare";
    tokens.push({ kind, value: text, at });
    at += text.length;
  }
  return tokens;
}

export function normalizeFilterExpressionQuotes(source: string): string {
  if (!/[‚‘’]/.test(source)) return source;
  try {
    const tokens = tokenize(source);
    let result = source;
    for (const token of tokens.reverse()) {
      if (token.normalized !== undefined) {
        result = result.slice(0, token.at) + token.normalized + result.slice(token.end);
      }
    }
    return result;
  } catch {
    return source;
  }
}

const KEYWORDS = new Set([
  "AND",
  "OR",
  "NOT",
  "IN",
  "IS",
  "NULL",
  "LIKE",
  "ILIKE",
  "BETWEEN",
  "WHERE",
]);

export function parseFilterExpression(
  source: string,
  columns: string[],
  kind?: FilterKind,
): ParsedFilter {
  if (kind === "mongodb" || kind === "redis") {
    throw new Error("SQL-Ausdrücke sind für diesen Datenbanktyp nicht verfügbar.");
  }
  if (source.length > 20_000) throw new Error("Der Filterausdruck ist zu lang.");
  const tokens = tokenize(source);
  let index = 0;
  const current = () => tokens[index];
  const keyword = (value: string) =>
    current()?.kind === "word" && current().value.toUpperCase() === value;
  const acceptKeyword = (value: string) => {
    if (!keyword(value)) return false;
    index++;
    return true;
  };
  const acceptSymbol = (value: string) => {
    if (current()?.kind !== "symbol" || current().value !== value) return false;
    index++;
    return true;
  };
  const expected = (value: string) => fail(`${value} erwartet`, current()?.at ?? source.length);
  const literal = (): { value: string; text: boolean } => {
    const token = current();
    const isBool = keyword("TRUE") || keyword("FALSE");
    if (
      !token ||
      token.kind === "symbol" ||
      (token.kind === "word" && !isBool && KEYWORDS.has(token.value.toUpperCase()))
    )
      return expected("Ein Wert (Text, Zahl oder TRUE/FALSE)");
    if (token.kind === "word" && !isBool && columns.includes(token.value)) {
      fail(
        `„${token.value}“ ist ein Spaltenname – Textwerte bitte in Anführungszeichen setzen`,
        token.at,
      );
    }
    index++;
    let value = isBool ? token.value.toLowerCase() : token.value;
    if (token.kind === "string") {
      while (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1).replace(/''/g, "'");
      }
    }
    if (!value.trim()) {
      fail("Leere Werte bitte im SQL-Modus filtern", token.at);
    }
    return { value, text: token.kind !== "number" && !isBool };
  };
  const supported = (operator: FilterOperatorKey, at: number) => {
    if (!filterOperatorsForKind(kind).some((entry) => entry.key === operator)) {
      fail("Dieser Operator wird von der Datenbank im einfachen Filter nicht unterstützt", at);
    }
    return operator;
  };
  const condition = (): Node => {
    const token = current();
    if (!token || !["word", "identifier"].includes(token.kind)) return expected("Ein Spaltenname");
    index++;
    const matches = columns.filter((column) => column.toLowerCase() === token.value.toLowerCase());
    const column = columns.includes(token.value)
      ? token.value
      : matches.length === 1
        ? matches[0]
        : undefined;
    if (column === undefined) fail(`Unbekannte oder mehrdeutige Spalte „${token.value}“`, token.at);
    const make = (operator: FilterOperatorKey, parsed?: { value: string; text: boolean }) => ({
      column,
      operator: supported(operator, token.at),
      value: parsed?.value ?? "",
      ...(parsed?.text ? { dataType: "text" } : {}),
    });
    if (acceptKeyword("IS")) {
      const not = acceptKeyword("NOT");
      if (!acceptKeyword("NULL")) expected("NULL");
      return make(not ? "isNotNull" : "isNull");
    }
    if (keyword("IN") || keyword("NOT")) {
      const not = acceptKeyword("NOT");
      if (!acceptKeyword("IN")) expected("IN");
      if (!acceptSymbol("(")) expected("(");
      const values = [literal()];
      while (acceptSymbol(",")) values.push(literal());
      if (!acceptSymbol(")")) expected(")");
      return make(not ? "notIn" : "in", {
        value: JSON.stringify(values.map((entry) => entry.value)),
        text: values.every((entry) => entry.text),
      });
    }
    if (acceptKeyword("LIKE") || acceptKeyword("ILIKE")) {
      const parsed = literal();
      const starts = parsed.value.startsWith("%");
      const ends = parsed.value.length > 1 && parsed.value.endsWith("%");
      const inner = parsed.value.slice(starts ? 1 : 0, ends ? -1 : undefined);
      if (/[%_]/.test(inner) || !inner) {
        fail("Platzhalter innerhalb des Musters bitte im SQL-Modus filtern", token.at);
      }
      const operator =
        starts && ends ? "contains" : starts ? "endsWith" : ends ? "startsWith" : "eq";
      return make(operator, { value: inner, text: true });
    }
    if (acceptKeyword("BETWEEN")) {
      const low = literal();
      if (!acceptKeyword("AND")) expected("AND");
      const high = literal();
      return { combinator: "AND", children: [make("gte", low), make("lte", high)] };
    }
    const operators: Record<string, FilterOperatorKey> = {
      "=": "eq",
      "!=": "neq",
      "<>": "neq",
      ">": "gt",
      ">=": "gte",
      "<": "lt",
      "<=": "lte",
    };
    const comparison = current();
    const found = comparison?.kind === "symbol" ? operators[comparison.value] : undefined;
    if (!found)
      return expected(
        "Ein Vergleichsoperator (=, <>, !=, >, >=, <, <=), LIKE, BETWEEN, IN oder IS NULL",
      );
    index++;
    if ((found === "eq" || found === "neq") && acceptKeyword("NULL")) {
      return make(found === "eq" ? "isNull" : "isNotNull");
    }
    return make(found, literal());
  };
  const primary = (depth: number): Node => {
    if (depth > 64) return expected("Weniger verschachtelte Klammern");
    if (!acceptSymbol("(")) return condition();
    const node = expression(depth + 1);
    if (!acceptSymbol(")")) expected(")");
    return node;
  };
  const conjunction = (depth: number): Node => {
    const children = [primary(depth)];
    while (acceptKeyword("AND")) children.push(primary(depth));
    return children.length === 1 ? children[0] : { combinator: "AND", children };
  };
  const expression = (depth: number): Node => {
    const children = [conjunction(depth)];
    while (acceptKeyword("OR")) children.push(conjunction(depth));
    return children.length === 1 ? children[0] : { combinator: "OR", children };
  };
  acceptKeyword("WHERE");
  const root = expression(0);
  if (current()) fail(`Unerwarteter Ausdruck „${current().value}“`, current().at);
  const combinator = "combinator" in root ? root.combinator : "AND";
  const conditions: ParsedFilterCondition[] = [];
  const collect = (node: Node) => {
    if (!("combinator" in node)) {
      conditions.push(node);
      return;
    }
    if (node.combinator !== combinator) {
      throw new Error("Gemischte AND/OR-Gruppen bitte im SQL-Modus filtern.");
    }
    node.children.forEach(collect);
  };
  collect(root);
  if (kind === "cassandra" && combinator === "OR") {
    throw new Error("OR wird von Cassandra nicht unterstützt.");
  }
  return { conditions, combinator };
}
