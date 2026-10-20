import type { DatabaseKind } from "@/lib/db";
import { tokenize } from "@/lib/sql-diagnostics/plsql-tokenize";
import { splitSqlStatements } from "@/lib/sql-statements";

export interface TableRef {
  schema: string | null;
  name: string;
  alias: string | null;
  qualifier: string;
  start: number;
  columns?: string[];
}

export interface CteDef {
  name: string;
  columns: string[];
}

export interface JoinTarget {
  ref: TableRef;
  others: TableRef[];
  using: boolean;
  condition: string;
}

export interface QueryScope {
  tables: TableRef[];
  ctes: CteDef[];
  join: JoinTarget | null;
}

interface Tok {
  upper: string;
  text: string;
  source: string;
  start: number;
  end: number;
  ident: boolean;
}

interface Block {
  start: number;
  end: number;
  parent: Block | null;
  query: boolean;
  isolated: boolean;
  items: Item[];
  refs: TableRef[];
  ctes: CteDef[];
}

type Item = Tok | Block;

const NOT_ALIAS = new Set(
  "WHERE ON USING JOIN INNER LEFT RIGHT FULL CROSS OUTER NATURAL GROUP ORDER HAVING LIMIT OFFSET FETCH UNION INTERSECT EXCEPT MINUS SET VALUES SELECT WINDOW FOR WITH PARTITION START CONNECT RETURNING LATERAL APPLY PIVOT UNPIVOT TABLESAMPLE SAMPLE QUALIFY PREWHERE FINAL ARRAY GLOBAL ANY ALL ASOF SEMI ANTI STRAIGHT_JOIN FROM INTO AS AND OR NOT IS IN WHEN THEN ELSE END LOOP BEGIN DO DEFAULT".split(
    " ",
  ),
);
const SELECT_END = new Set(["FROM", "INTO", "WHERE", "UNION", "INTERSECT", "EXCEPT", "MINUS"]);
const JOIN_END = new Set(
  "WHERE JOIN INNER LEFT RIGHT FULL CROSS NATURAL GROUP ORDER HAVING LIMIT UNION INTERSECT EXCEPT MINUS WINDOW QUALIFY USING SET".split(
    " ",
  ),
);

const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const isBlock = (item: Item | undefined): item is Block => item !== undefined && "items" in item;
const isTok = (item: Item | undefined, upper?: string): item is Tok =>
  item !== undefined && !("items" in item) && (upper === undefined || item.upper === upper);
const isIdent = (item: Item | undefined): item is Tok => isTok(item) && item.ident;
const isName = (item: Item | undefined): item is Tok => isIdent(item) && !NOT_ALIAS.has(item.upper);

function lex(sql: string, dialect?: DatabaseKind): Tok[] {
  const raw = tokenize(sql, []);
  const out: Tok[] = [];
  const brackets = dialect === "mssql" || dialect === "sqlite" || dialect === "sqlite_http";
  for (let i = 0; i < raw.length; i++) {
    const { upper, start, end } = raw[i];
    const close = upper === "`" ? "`" : upper === "[" && brackets ? "]" : null;
    if (close) {
      let j = i + 1;
      while (j < raw.length && raw[j].upper !== close) j++;
      if (j < raw.length) {
        const text = sql.slice(start + 1, raw[j].start);
        const source = sql.slice(start, raw[j].end);
        out.push({ upper: "`", text, source, start, end: raw[j].end, ident: true });
        i = j;
        continue;
      }
    }
    if (upper === '"') {
      const text = sql.slice(start + 1, end - 1).replaceAll('""', '"');
      out.push({ upper, text, source: sql.slice(start, end), start, end, ident: true });
      continue;
    }
    const word = /^[A-Z_]/.test(upper);
    const source = sql.slice(start, end);
    out.push({ upper, text: word ? source : upper, source, start, end, ident: word });
  }
  return out;
}

function block(start: number, parent: Block | null): Block {
  return {
    start,
    end: Number.POSITIVE_INFINITY,
    parent,
    query: !parent,
    isolated: false,
    items: [],
    refs: [],
    ctes: [],
  };
}

function nameList(list: Block): string[] {
  return list.items.filter(isName).map((tok) => tok.text);
}

function itemName(group: Item[]): string | null {
  const last = group.at(-1);
  if (!isIdent(last)) return null;
  if (group.length === 1) return last.text;
  const prev = group.at(-2);
  if (isBlock(prev)) return last.text;
  if (!isTok(prev)) return null;
  if (prev.upper === ".") {
    const dotted = group.every((item, index) => (index % 2 ? isTok(item, ".") : isIdent(item)));
    return dotted ? last.text : null;
  }
  return prev.ident || prev.upper === "'" || /^\d/.test(prev.upper) ? last.text : null;
}

function selectColumns(body: Block): string[] {
  const items = body.items;
  let i = items.findIndex((item) => isTok(item, "SELECT")) + 1;
  if (i === 0) return [];
  while (isTok(items[i], "DISTINCT") || isTok(items[i], "ALL") || isTok(items[i], "UNIQUE")) i++;
  if (isTok(items[i], "TOP")) i += 2;
  const names: string[] = [];
  let group: Item[] = [];
  for (; ; i++) {
    const item = items[i];
    const stop = item === undefined || (isTok(item) && SELECT_END.has(item.upper));
    if (stop || isTok(item, ",")) {
      const name = itemName(group);
      if (name) names.push(name);
      if (stop) return names;
      group = [];
    } else group.push(item);
  }
}

function parseRefs(owner: Block, from: number, list: boolean): number {
  const items = owner.items;
  let j = from;
  for (;;) {
    const lateral = isTok(items[j], "LATERAL");
    if (lateral || isTok(items[j], "ONLY")) j++;
    const item = items[j];
    let ref: TableRef;
    if (isBlock(item)) {
      item.isolated ||= !lateral;
      ref = {
        schema: null,
        name: "",
        alias: null,
        qualifier: "",
        start: item.start,
        columns: selectColumns(item),
      };
      j++;
    } else if (isName(item)) {
      const parts = [item];
      j++;
      while (isTok(items[j], ".") && isIdent(items[j + 1])) {
        parts.push(items[j + 1] as Tok);
        j += 2;
      }
      if (isTok(items[j], ".")) return j;
      const last = parts[parts.length - 1];
      ref = {
        schema: parts.at(-2)?.text ?? null,
        name: last.text,
        alias: null,
        qualifier: last.source,
        start: item.start,
      };
      if (isBlock(items[j])) j++;
    } else return j - 1;
    if (isTok(items[j], "AS")) j++;
    const alias = items[j];
    if (isName(alias)) {
      ref.alias = alias.text;
      ref.qualifier = alias.source;
      ref.name ||= alias.text;
      j++;
      const columns = items[j];
      if (ref.columns && isBlock(columns)) {
        ref.columns = nameList(columns);
        j++;
      }
    }
    if (ref.name) owner.refs.push(ref);
    if (!list || !isTok(items[j], ",")) return j - 1;
    j++;
  }
}

function parseCtes(owner: Block, from: number): void {
  const items = owner.items;
  let i = isTok(items[from], "RECURSIVE") ? from + 1 : from;
  for (;;) {
    const name = items[i];
    if (!isName(name)) return;
    i++;
    const list = items[i];
    const declared = isBlock(list) ? nameList(list) : null;
    if (declared) i++;
    if (!isTok(items[i], "AS")) return;
    i++;
    while (isTok(items[i], "NOT") || isTok(items[i], "MATERIALIZED")) i++;
    const body = items[i];
    if (!isBlock(body)) return;
    body.isolated = true;
    owner.ctes.push({ name: name.text, columns: declared ?? selectColumns(body) });
    i++;
    if (!isTok(items[i], ",")) return;
    i++;
  }
}

function parseBlock(owner: Block): void {
  const items = owner.items;
  if (owner.parent) owner.query = isTok(items[0], "SELECT") || isTok(items[0], "WITH");
  if (owner.query) {
    const head = items.findIndex(
      (item) => isBlock(item) || isTok(item, "SELECT") || isTok(item, "WITH"),
    );
    if (isTok(items[head], "WITH")) parseCtes(owner, head + 1);
    for (let k = 0; k < items.length; k++) {
      const item = items[k];
      if (!isTok(item)) continue;
      if (item.upper === "FROM" || item.upper === "UPDATE") k = parseRefs(owner, k + 1, true);
      else if (item.upper === "JOIN" || item.upper === "INTO" || item.upper === "APPLY")
        k = parseRefs(owner, k + 1, false);
      else if (item.upper === "USING" && !isBlock(items[k + 1])) k = parseRefs(owner, k + 1, false);
    }
  }
  for (const item of items) if (isBlock(item)) parseBlock(item);
}

function build(sql: string, offset: number, dialect?: DatabaseKind): Block {
  const tokens = lex(sql, dialect);
  let from = 0;
  let to = tokens.length;
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].upper !== ";") continue;
    if (tokens[i].end <= offset) from = i + 1;
    else {
      to = i;
      break;
    }
  }
  const root = block(-1, null);
  let current = root;
  for (let i = from; i < to; i++) {
    const tok = tokens[i];
    if (tok.upper === "(") {
      const child = block(tok.start, current);
      current.items.push(child);
      current = child;
    } else if (tok.upper === ")" && current.parent) {
      current.end = tok.end;
      current = current.parent;
    } else current.items.push(tok);
  }
  parseBlock(root);
  return root;
}

function joinTarget(query: Block, inner: Block, offset: number, sql: string): JoinTarget | null {
  const items = query.items;
  const using = inner !== query;
  let end = using ? items.indexOf(inner) : items.findIndex((item) => item.start >= offset);
  if (using) {
    if (end < 1 || !isTok(items[end - 1], "USING")) return null;
    end--;
  } else {
    if (end < 0) end = items.length;
    const last = items[end - 1];
    if (isIdent(last) && last.end === offset) end--;
    if (!isTok(items[end - 1], "ON") && !isTok(items[end - 1], "AND")) return null;
  }
  let on = -1;
  let join = end - 1;
  for (; join >= 0; join--) {
    const item = items[join];
    if (!isTok(item)) continue;
    if (item.upper === "JOIN") break;
    if (item.upper === "ON") on = join;
    else if (JOIN_END.has(item.upper)) return null;
  }
  if (join < 0 || (using ? on >= 0 : on < 0)) return null;
  const limit = items[using ? end : on].start;
  const start = items[join].start;
  const index = query.refs.findIndex((ref) => ref.start > start && ref.start < limit);
  if (index < 0) return null;
  const from = using ? inner.start + 1 : (items[on] as Tok).end;
  return {
    ref: query.refs[index],
    others: query.refs.slice(0, index),
    using,
    condition: sql.slice(from, offset),
  };
}

export function findRef(scope: QueryScope, qualifier: string): TableRef | undefined {
  return (
    scope.tables.find((ref) => ref.alias !== null && eq(ref.alias, qualifier)) ??
    scope.tables.find((ref) => eq(ref.name, qualifier))
  );
}

export function scopeAt(sql: string, offset: number, dialect?: DatabaseKind): QueryScope {
  let inner = build(sql, offset, dialect);
  for (;;) {
    const child = inner.items.find(
      (item): item is Block => isBlock(item) && item.start < offset && offset < item.end,
    );
    if (!child) break;
    inner = child;
  }
  let query = inner;
  while (!query.query && query.parent) query = query.parent;
  const tables: TableRef[] = [];
  const ctes: CteDef[] = [];
  let visible = true;
  for (let current: Block | null = query; current; current = current.parent) {
    if (!current.query) continue;
    if (visible) tables.push(...current.refs);
    ctes.push(...current.ctes);
    if (current.isolated) visible = false;
  }
  const withCte = (ref: TableRef): TableRef => {
    if (ref.columns || ref.schema) return ref;
    const cte = ctes.find((def) => eq(def.name, ref.name));
    return cte ? { ...ref, columns: cte.columns } : ref;
  };
  const join = joinTarget(query, inner, offset, sql);
  return {
    tables: tables.map(withCte),
    ctes,
    join: join && { ...join, ref: withCte(join.ref), others: join.others.map(withCte) },
  };
}

export function statementBounds(
  sql: string,
  offset: number,
  dialect?: string,
): { start: number; end: number } {
  let start = 0;
  for (const statement of splitSqlStatements(sql, dialect).statements) {
    if (statement.start > offset) return { start, end: statement.start };
    const open = !statement.text.endsWith(";") && !sql.slice(statement.end, offset).trim();
    if (offset <= statement.end || open)
      return { start: statement.start, end: Math.max(statement.end, offset) };
    start = statement.end;
  }
  return { start, end: sql.length };
}
