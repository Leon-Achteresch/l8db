import type { QueryClient, QueryState } from "@tanstack/react-query";
import type { DetailedColumnInfo, TableInfo } from "@/lib/db";

export const LOADED_COMMENT_RESULTS_LIMIT = 60;
export const LOADED_COMMENT_TERM_LIMIT = 160;
const MAX_METADATA_AGE = 5 * 60_000;
const MAX_CATALOG_ROWS = 20_000;
const MAX_COMMENT_ROWS = 2_500;
const MAX_COMMENT_LENGTH = 4_096;
const MAX_COMMENT_TEXT = 2_000_000;
const EXCERPT_LENGTH = 180;

export interface LoadedCommentScope {
  connectionId: string;
  database: string | null;
  schema?: string;
  allowedSchemas?: readonly string[];
}

export interface LoadedComment {
  schema: string;
  table: string;
  column?: string;
  key: string;
  text: string;
  folded: string;
  clipped: boolean;
  expiresAt: number;
}

interface LoadedComments {
  entries: LoadedComment[];
  expiresAt: number;
  limited: boolean;
}

export function isLoadedCommentQuery(key: readonly unknown[], scope: LoadedCommentScope) {
  const [root, connection, database, schema, table] = key;
  return (
    connection === scope.connectionId &&
    database === scope.database &&
    typeof schema === "string" &&
    (scope.schema === undefined || scope.schema === schema) &&
    (!scope.allowedSchemas?.length || scope.allowedSchemas.includes(schema)) &&
    ((root === "tables" && key.length === 4) ||
      ((root === "table-comment" || root === "columns-detailed") &&
        typeof table === "string" &&
        key.length === 5))
  );
}

function isRecent<T>(
  state: QueryState<T> | undefined,
  now: number,
): state is QueryState<T> & { data: T } {
  return (
    state?.status === "success" &&
    state.data !== undefined &&
    !state.isInvalidated &&
    state.dataUpdatedAt > 0 &&
    state.dataUpdatedAt <= now &&
    state.dataUpdatedAt + MAX_METADATA_AGE > now
  );
}

export function readLoadedObjectComments(
  client: QueryClient,
  scope: LoadedCommentScope,
  now = Date.now(),
): LoadedComments {
  const result: LoadedComments = { entries: [], expiresAt: Infinity, limited: false };
  const catalogs = new Map<string, { names: Set<string>; updatedAt: number } | undefined>();
  let catalogRows = 0;
  let commentRows = 0;
  let textUnits = 0;

  const tableCatalog = (schema: string) => {
    if (!catalogs.has(schema)) {
      const state = client.getQueryState<TableInfo[]>([
        "tables",
        scope.connectionId,
        scope.database,
        schema,
      ]);
      const names = new Set<string>();
      if (isRecent(state, now) && Array.isArray(state.data)) {
        for (const table of state.data) {
          if (catalogRows >= MAX_CATALOG_ROWS) {
            result.limited = true;
            break;
          }
          catalogRows++;
          if (table?.schema === schema && typeof table.name === "string") names.add(table.name);
        }
        catalogs.set(schema, { names, updatedAt: state.dataUpdatedAt });
      } else catalogs.set(schema, undefined);
    }
    return catalogs.get(schema);
  };

  const add = (
    text: unknown,
    schema: string,
    table: string,
    expiresAt: number,
    column?: string,
  ) => {
    if (commentRows >= MAX_COMMENT_ROWS || textUnits >= MAX_COMMENT_TEXT) {
      result.limited = true;
      return false;
    }
    commentRows++;
    if (typeof text !== "string" || !text) return true;
    const sample = text.slice(0, Math.min(MAX_COMMENT_LENGTH, MAX_COMMENT_TEXT - textUnits));
    textUnits += sample.length;
    const clipped = sample.length < text.length;
    if (clipped) result.limited = true;
    if (!sample.trim()) return true;
    result.expiresAt = Math.min(result.expiresAt, expiresAt);
    result.entries.push({
      key: JSON.stringify([schema, table, column]),
      schema,
      table,
      column,
      text: sample,
      folded: sample.toLowerCase(),
      clipped,
      expiresAt,
    });
    return true;
  };

  for (const query of client.getQueryCache().getAll()) {
    const [root, , , schema, table] = query.queryKey;
    if (
      root === "tables" ||
      typeof schema !== "string" ||
      typeof table !== "string" ||
      !isLoadedCommentQuery(query.queryKey, scope) ||
      !isRecent(query.state, now)
    )
      continue;
    const catalog = tableCatalog(schema);
    if (!catalog?.names.has(table)) continue;
    const expiresAt = Math.min(query.state.dataUpdatedAt, catalog.updatedAt) + MAX_METADATA_AGE;
    if (root === "table-comment") {
      if (!add(query.state.data, schema, table, expiresAt)) break;
    } else if (Array.isArray(query.state.data)) {
      for (const column of query.state.data as DetailedColumnInfo[]) {
        const name = typeof column?.name === "string" ? column.name : undefined;
        if (!add(name ? column.comment : null, schema, table, expiresAt, name)) return result;
      }
    }
  }
  return result;
}

export function matchLoadedObjectComments(entries: readonly LoadedComment[], term: string) {
  const query = term.trim();
  const matches: { entry: LoadedComment; excerpt: string }[] = [];
  if (query.length < 2 || query.length > LOADED_COMMENT_TERM_LIMIT) return { matches, more: false };
  const needle = query.toLowerCase();
  for (const entry of entries) {
    const at = entry.folded.indexOf(needle);
    if (at < 0) continue;
    if (matches.length >= LOADED_COMMENT_RESULTS_LIMIT) return { matches, more: true };
    const start = entry.text.length === entry.folded.length ? Math.max(0, at - 35) : 0;
    const excerpt = entry.text
      .slice(start, start + EXCERPT_LENGTH)
      .replace(/\s+/g, " ")
      .trim();
    const tail = entry.clipped || start + EXCERPT_LENGTH < entry.text.length;
    matches.push({ entry, excerpt: `${start ? "…" : ""}${excerpt}${tail ? "…" : ""}` });
  }
  return { matches, more: false };
}

export function observeLoadedObjectComments(client: QueryClient, scope: LoadedCommentScope) {
  let current: LoadedComments | undefined;
  const getSnapshot = () => (current ??= readLoadedObjectComments(client, scope));
  const subscribe = (change: () => void) => {
    current = undefined;
    let expiry: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(expiry);
      const at = getSnapshot().expiresAt;
      if (Number.isFinite(at)) expiry = setTimeout(refresh, Math.max(0, at - Date.now()));
    };
    const refresh = () => {
      current = undefined;
      change();
      schedule();
    };
    const unsubscribe = client.getQueryCache().subscribe((event) => {
      if (
        (event.type === "updated" || event.type === "removed") &&
        isLoadedCommentQuery(event.query.queryKey, scope)
      )
        refresh();
    });
    schedule();
    return () => {
      clearTimeout(expiry);
      unsubscribe();
    };
  };
  return { getSnapshot, subscribe };
}
