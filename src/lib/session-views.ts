import { create } from "zustand";
import type { SavedConnection } from "@/lib/connections/types";
import { type DatabaseKind, executeQuery, type QueryResult } from "@/lib/db";
import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";
import { sqlTokens } from "@/lib/sql-safety";
import { splitSqlStatements } from "@/lib/sql-statements";
import { effectiveConnectionString } from "@/lib/ssh/connection-string";

export interface SessionView {
  name: string;
  sql: string;
  columns: string[];
  createdAt: number;
}

const NATIVE_TEMP_VIEW_KINDS = new Set<DatabaseKind>(["sqlite", "duckdb"]);
const EMULATED_KINDS = new Set<DatabaseKind>([
  "postgres",
  "mysql",
  "mssql",
  "oracle",
  "clickhouse",
  "athena",
  "bigquery",
  "snowflake",
]);

export type TemporaryViewMode = "native" | "emulated";

export function temporaryViewMode(kind: DatabaseKind | null | undefined): TemporaryViewMode | null {
  if (!kind) return null;
  if (NATIVE_TEMP_VIEW_KINDS.has(kind)) return "native";
  if (EMULATED_KINDS.has(kind)) return "emulated";
  return null;
}

export function scopeKey(connectionId: string, database: string | null | undefined): string {
  return `${connectionId}\n${database ?? ""}`;
}

interface SessionViewsState {
  views: Record<string, SessionView[]>;
  add: (scope: string, view: SessionView) => void;
  remove: (scope: string, name: string) => void;
  clearConnection: (connectionId: string) => void;
}

const EMPTY: SessionView[] = [];
const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const useSessionViewsStore = create<SessionViewsState>()((set) => ({
  views: {},
  add: (scope, view) =>
    set((state) => ({
      views: {
        ...state.views,
        [scope]: [...(state.views[scope] ?? []).filter((v) => !sameName(v.name, view.name)), view],
      },
    })),
  remove: (scope, name) =>
    set((state) => ({
      views: {
        ...state.views,
        [scope]: (state.views[scope] ?? []).filter((v) => !sameName(v.name, name)),
      },
    })),
  clearConnection: (connectionId) =>
    set((state) => ({
      views: Object.fromEntries(
        Object.entries(state.views).filter(([key]) => !key.startsWith(`${connectionId}\n`)),
      ),
    })),
}));

export function sessionViewsFor(
  connectionId: string | null | undefined,
  database: string | null | undefined,
): SessionView[] {
  if (!connectionId) return EMPTY;
  return useSessionViewsStore.getState().views[scopeKey(connectionId, database)] ?? EMPTY;
}

export function useSessionViews(
  connectionId: string | null | undefined,
  database: string | null | undefined,
): SessionView[] {
  return useSessionViewsStore((state) =>
    connectionId ? (state.views[scopeKey(connectionId, database)] ?? EMPTY) : EMPTY,
  );
}

const PLAIN_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TRIVIA = /^(?:\s|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/;

function refName(name: string, kind: DatabaseKind): string {
  return PLAIN_IDENTIFIER.test(name) ? name : quoteIdentifier(name, identifierStyleForKind(kind));
}

function leadWord(sql: string): string {
  const rest = sql.slice(TRIVIA.exec(sql)?.[0].length ?? 0);
  return /^[A-Za-z]+/.exec(rest.replace(/^\(\s*/, ""))?.[0].toUpperCase() ?? "";
}

function stripTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, "");
}

function unquote(text: string): string {
  const open = text[0];
  const close = open === "[" ? "]" : open;
  return text
    .slice(1, -1)
    .split(close + close)
    .join(close);
}

function identifierNames(sql: string, kind: DatabaseKind): Set<string> {
  const names = new Set<string>();
  const tokens = sqlTokens(sql, kind);
  for (const token of tokens) {
    let name: string;
    let end: number;
    if (token.word === "identifier") {
      const open = sql[token.start];
      if (open === "'") continue;
      const close = open === "[" ? "]" : open;
      let i = token.start + 1;
      while (i < sql.length) {
        if (sql[i] === close) {
          if (sql[i + 1] === close) i += 2;
          else break;
        } else i++;
      }
      end = i + 1;
      name = unquote(sql.slice(token.start, end));
    } else if (/^[A-Z_]/.test(token.word)) {
      end = token.start + token.word.length;
      name = sql.slice(token.start, end);
    } else continue;
    const before = sql.slice(0, token.start).trimEnd();
    if (before.endsWith(".")) continue;
    if (/^\s*\(/.test(sql.slice(end))) continue;
    names.add(name.toLowerCase());
  }
  return names;
}

interface LeadingWith {
  recursive: boolean;
  ctes: { name: string; text: string }[];
  body: string;
}

function skipTrivia(sql: string, pos: number): number {
  return pos + (TRIVIA.exec(sql.slice(pos))?.[0].length ?? 0);
}

export function parseLeadingWith(sql: string, kind: DatabaseKind): LeadingWith | null {
  const tokens = sqlTokens(sql, kind).filter((token) => token.depth === 0);
  if (tokens[0]?.word !== "WITH") return null;
  let index = 1;
  let recursive = false;
  if (tokens[index]?.word === "RECURSIVE") {
    recursive = true;
    index++;
  }
  const ctes: LeadingWith["ctes"] = [];
  while (index < tokens.length) {
    const nameToken = tokens[index++];
    if (!nameToken || nameToken.word === ")" || nameToken.word === ";") return null;
    const name =
      nameToken.word === "identifier"
        ? identifierNames(sql.slice(nameToken.start), kind).values().next().value
        : sql.slice(nameToken.start, nameToken.start + nameToken.word.length);
    if (!name) return null;
    while (tokens[index]?.word === ")") index++;
    if (tokens[index]?.word !== "AS") return null;
    index++;
    while (tokens[index] && tokens[index].word !== ")") index++;
    const closing = tokens[index++];
    if (!closing) return null;
    ctes.push({ name, text: sql.slice(nameToken.start, closing.start + 1) });
    const next = skipTrivia(sql, closing.start + 1);
    if (sql[next] === ",") {
      while (index < tokens.length && tokens[index].start < next) index++;
      continue;
    }
    const body = sql.slice(next);
    if (!body.trim()) return null;
    return { recursive, ctes, body };
  }
  return null;
}

function cteEntries(view: SessionView, kind: DatabaseKind): { name: string; text: string }[] {
  const sql = stripTrailingSemicolon(view.sql);
  const own = parseLeadingWith(sql, kind);
  const body = own ? own.body : sql;
  return [
    ...(own?.ctes ?? []),
    { name: view.name, text: `${refName(view.name, kind)} AS (\n${body}\n)` },
  ];
}

export function referencedSessionViews(
  sql: string,
  views: SessionView[],
  kind: DatabaseKind,
): SessionView[] {
  if (!views.length) return [];
  const names = identifierNames(sql, kind);
  return views.filter((view) => names.has(view.name.toLowerCase()));
}

function orderedViews(
  roots: SessionView[],
  views: SessionView[],
  kind: DatabaseKind,
): SessionView[] {
  const ordered: SessionView[] = [];
  const visiting = new Set<string>();
  const visit = (view: SessionView) => {
    const key = view.name.toLowerCase();
    if (ordered.some((v) => sameName(v.name, view.name))) return;
    if (visiting.has(key))
      throw new Error(`Sitzungs-View „${view.name}“ verweist zirkulär auf sich selbst.`);
    visiting.add(key);
    for (const dep of referencedSessionViews(view.sql, views, kind)) {
      if (!sameName(dep.name, view.name)) visit(dep);
    }
    visiting.delete(key);
    ordered.push(view);
  };
  for (const root of roots) visit(root);
  return ordered;
}

function expandStatement(statement: string, views: SessionView[], kind: DatabaseKind): string {
  const own = parseLeadingWith(statement, kind);
  const shadowed = new Set((own?.ctes ?? []).map((cte) => cte.name.toLowerCase()));
  const roots = referencedSessionViews(statement, views, kind).filter(
    (view) => !shadowed.has(view.name.toLowerCase()),
  );
  if (!roots.length) return statement;
  const lead = leadWord(statement);
  if (lead !== "SELECT" && lead !== "WITH") {
    throw new Error(
      `Sitzungs-View „${roots[0].name}“ kann nur in SELECT-Abfragen verwendet werden. Für ${lead || "dieses Statement"} lege eine echte View an.`,
    );
  }
  const entries: { name: string; text: string }[] = [];
  const push = (entry: { name: string; text: string }) => {
    const existing = entries.find((e) => sameName(e.name, entry.name));
    if (!existing) entries.push(entry);
    else if (existing.text !== entry.text)
      throw new Error(`CTE-Name „${entry.name}“ kollidiert zwischen Abfrage und Sitzungs-Views.`);
  };
  for (const view of orderedViews(roots, views, kind)) {
    for (const entry of cteEntries(view, kind)) push(entry);
  }
  for (const cte of own?.ctes ?? []) push(cte);
  const recursive =
    (own?.recursive ?? false) ||
    orderedViews(roots, views, kind).some((view) => parseLeadingWith(view.sql, kind)?.recursive);
  const body = own ? own.body : statement.slice(TRIVIA.exec(statement)?.[0].length ?? 0);
  return `WITH ${recursive ? "RECURSIVE " : ""}${entries.map((e) => e.text).join(",\n")}\n${body}`;
}

export function expandSessionViews(sql: string, views: SessionView[], kind: DatabaseKind): string {
  if (!views.length || !sql.trim()) return sql;
  const { statements } = splitSqlStatements(sql, kind);
  let result = sql;
  for (const statement of [...statements].reverse()) {
    const expanded = expandStatement(statement.text, views, kind);
    if (expanded === statement.text) continue;
    const start = result.indexOf(statement.text, statement.start);
    if (start < 0) continue;
    result = result.slice(0, start) + expanded + result.slice(start + statement.text.length);
  }
  return result;
}

const NAME_PART = String.raw`(?:"[^"]+"|\`[^\`]+\`|\[[^\]]+\]|[A-Za-z_][\w$]*)`;
const CREATE_TEMP_VIEW = new RegExp(
  String.raw`^CREATE\s+(OR\s+REPLACE\s+)?(?:TEMP|TEMPORARY)\s+VIEW\s+(IF\s+NOT\s+EXISTS\s+)?(${NAME_PART}(?:\.${NAME_PART})*)\s*(\([^)]*\))?\s*AS\s+([\s\S]+)$`,
  "i",
);
const DROP_VIEW = new RegExp(
  String.raw`^DROP\s+VIEW\s+(IF\s+EXISTS\s+)?(${NAME_PART}(?:\.${NAME_PART})*)\s*;?\s*$`,
  "i",
);

function parseName(raw: string): string {
  const parts = raw.split(".");
  const last = parts[parts.length - 1];
  if (parts.length > 1) {
    throw new Error("Sitzungs-Views haben kein Schema. Gib den Namen ohne Schema-Präfix an.");
  }
  return /^["`[]/.test(last) ? unquote(last) : last;
}

function emptyResult(notice: string): QueryResult {
  return { columns: [], rows: [], rows_affected: 0, execution_time_ms: 0, notice };
}

export async function createSessionView(
  connection: SavedConnection,
  database: string | null,
  name: string,
  sql: string,
): Promise<SessionView> {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Name fehlt.");
  parseName(trimmedName);
  const kind = connection.kind;
  const candidate: SessionView = {
    name: trimmedName,
    sql: stripTrailingSemicolon(sql),
    columns: [],
    createdAt: Date.now(),
  };
  if (leadWord(candidate.sql) !== "SELECT" && leadWord(candidate.sql) !== "WITH") {
    throw new Error("Eine Sitzungs-View braucht eine SELECT-Abfrage.");
  }
  const scope = scopeKey(connection.id, database);
  const others = sessionViewsFor(connection.id, database).filter(
    (view) => !sameName(view.name, trimmedName),
  );
  const probe = expandSessionViews(
    `SELECT * FROM ${refName(trimmedName, kind)} WHERE 1 = 0`,
    [...others, candidate],
    kind,
  );
  const result = await executeQuery(
    kind,
    effectiveConnectionString(connection),
    probe,
    database ?? undefined,
    { confirmed: true },
  );
  const view = { ...candidate, columns: result.columns };
  useSessionViewsStore.getState().add(scope, view);
  return view;
}

export async function runSessionViewStatement(
  connection: SavedConnection,
  database: string | null,
  sql: string,
): Promise<QueryResult | null> {
  if (temporaryViewMode(connection.kind) !== "emulated") return null;
  const text = stripTrailingSemicolon(sql.slice(TRIVIA.exec(sql)?.[0].length ?? 0));
  const created = CREATE_TEMP_VIEW.exec(text);
  if (created) {
    if (created[4]) {
      throw new Error(
        "Sitzungs-Views unterstützen keine Spaltenliste. Benenne die Spalten im SELECT.",
      );
    }
    const name = parseName(created[3]);
    const existing = sessionViewsFor(connection.id, database).find((view) =>
      sameName(view.name, name),
    );
    if (existing && created[2]) return emptyResult(`Sitzungs-View „${name}“ existiert bereits.`);
    if (existing && !created[1]) throw new Error(`Sitzungs-View „${name}“ existiert bereits.`);
    await createSessionView(connection, database, name, created[5]);
    return emptyResult(`Sitzungs-View „${name}“ angelegt (nur in dieser l8db-Sitzung)`);
  }
  const dropped = DROP_VIEW.exec(text);
  if (dropped) {
    const parts = dropped[2].split(".");
    if (parts.length > 1) return null;
    const name = /^["`[]/.test(parts[0]) ? unquote(parts[0]) : parts[0];
    const scope = scopeKey(connection.id, database);
    const existing = sessionViewsFor(connection.id, database).find((view) =>
      sameName(view.name, name),
    );
    if (!existing) return null;
    useSessionViewsStore.getState().remove(scope, name);
    return emptyResult(`Sitzungs-View „${existing.name}“ entfernt`);
  }
  return null;
}
