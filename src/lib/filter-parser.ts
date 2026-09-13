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
  kind: "word" | "identifier" | "string" | "number" | "symbol";
  value: string;
  at: number;
  end?: number;
  normalized?: string;
};
type Node = ParsedFilterCondition | { combinator: "AND" | "OR"; children: Node[] };

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
    const number = source.slice(at).match(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?/i);
    const word = source.slice(at).match(/^[\p{L}_][\p{L}\p{N}_$]*/u);
    const symbol = source.slice(at).match(/^(?:>=|<=|<>|!=|[=><(),])/);
    const match = number ?? word ?? symbol;
    if (!match) fail(`Unerwartetes Zeichen „${source[at]}“`, at);
    tokens.push({ kind: number ? "number" : word ? "word" : "symbol", value: match[0], at });
    at += match[0].length;
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
  const literal = (): { value: string; quoted: boolean } => {
    const token = current();
    if (
      !token ||
      !(token.kind === "string" || token.kind === "number" || keyword("TRUE") || keyword("FALSE"))
    )
      return expected("Ein Wert in einfachen Anführungszeichen, eine Zahl oder TRUE/FALSE");
    index++;
    let value = token.kind === "word" ? token.value.toLowerCase() : token.value;
    if (token.kind === "string") {
      while (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
        value = value.slice(1, -1).replace(/''/g, "'");
      }
    }
    if (!value.trim()) {
      fail("Leere Werte bitte im SQL-Modus filtern", token.at);
    }
    return {
      value,
      quoted: token.kind === "string",
    };
  };
  const condition = (): ParsedFilterCondition => {
    const token = current();
    if (!token || !["word", "identifier"].includes(token.kind)) return expected("Ein Spaltenname");
    index++;
    const matches = columns.filter((column) => column.toLowerCase() === token.value.toLowerCase());
    const column = columns.includes(token.value)
      ? token.value
      : token.kind === "word" && matches.length === 1
        ? matches[0]
        : undefined;
    if (column === undefined) fail(`Unbekannte oder mehrdeutige Spalte „${token.value}“`, token.at);
    let operator: FilterOperatorKey;
    let value = "";
    let dataType: string | undefined;
    if (acceptKeyword("IS")) {
      operator = acceptKeyword("NOT") ? "isNotNull" : "isNull";
      if (!acceptKeyword("NULL")) expected("NULL");
    } else if (keyword("IN") || keyword("NOT")) {
      operator = acceptKeyword("NOT") ? "notIn" : "in";
      if (!acceptKeyword("IN")) expected("IN");
      if (!acceptSymbol("(")) expected("(");
      const values = [literal()];
      while (acceptSymbol(",")) values.push(literal());
      if (!acceptSymbol(")")) expected(")");
      if (values.some((entry) => entry.quoted !== values[0].quoted)) {
        fail("Listen mit gemischten Text- und Zahlenwerten bitte im SQL-Modus filtern", token.at);
      }
      value = JSON.stringify(values.map((entry) => entry.value));
      dataType = values[0].quoted ? "text" : undefined;
    } else {
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
        return expected("Ein Vergleichsoperator (=, <>, !=, >, >=, <, <=), IN oder IS NULL");
      operator = found;
      index++;
      const parsed = literal();
      value = parsed.value;
      dataType = parsed.quoted ? "text" : undefined;
    }
    if (!filterOperatorsForKind(kind).some((entry) => entry.key === operator)) {
      fail(
        "Dieser Operator wird von der Datenbank im einfachen Filter nicht unterstützt",
        token.at,
      );
    }
    return { column, operator, value, ...(dataType ? { dataType } : {}) };
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
