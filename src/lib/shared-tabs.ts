import type { SortingState } from "@tanstack/react-table";
import type { SavedConnection } from "@/lib/connections";
import type { FilterCondition, TableViewState } from "@/lib/table-view-state";

export const SHARED_TAB_PREFIX = "l8db://tab/";
export const MAX_SHARED_TAB_LINK = 1_000_000;
const LINK_PATTERN = /l8db:\/\/tab\/([A-Za-z0-9_-]+)/;

export interface SharedConnectionRef {
  name: string;
  kind: string;
  team?: string;
  host?: string;
  port?: string;
}

export type SharedView = Pick<
  TableViewState,
  | "filter"
  | "filterRaw"
  | "filterMode"
  | "filterConditions"
  | "filterCombinator"
  | "filterSql"
  | "sorting"
>;

interface SharedBase {
  v: 1;
  connection: SharedConnectionRef;
  database: string | null;
}

export type SharedTableTab = SharedBase & {
  kind: "table";
  schema: string;
  table: string;
  entityType: "table" | "view";
  view: Partial<SharedView>;
};

export type SharedQueryTab = SharedBase & { kind: "query"; title: string; sql: string };

export type SharedTab = SharedTableTab | SharedQueryTab;

export function connectionRef(connection: SavedConnection): SharedConnectionRef {
  const ref: SharedConnectionRef = { name: connection.name, kind: connection.kind };
  if (connection.team?.id) ref.team = connection.team.id;
  try {
    const url = new URL(connection.connectionString);
    if (url.hostname) {
      const via = connection.ssh?.host ? `${connection.ssh.host.toLowerCase()}>` : "";
      ref.host = via + url.hostname.toLowerCase();
      if (url.port) ref.port = url.port;
    }
  } catch {}
  return ref;
}

export function sharedViewOf(view: Partial<TableViewState> | undefined): Partial<SharedView> {
  if (!view) return {};
  const shared: Partial<SharedView> = {};
  if (view.filter) shared.filter = view.filter;
  if (view.filterRaw) shared.filterRaw = true;
  if (view.filterMode) shared.filterMode = view.filterMode;
  if (view.filterConditions?.length) shared.filterConditions = view.filterConditions;
  if (view.filterCombinator) shared.filterCombinator = view.filterCombinator;
  if (view.filterSql) shared.filterSql = view.filterSql;
  if (view.sorting?.length) shared.sorting = view.sorting;
  return shared;
}

const COMPRESS_FROM = 4_000;
const MAX_JSON_BYTES = 4_000_000;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function readLimited(stream: ReadableStream<Uint8Array>): Promise<Uint8Array | null> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_JSON_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function streamOf(bytes: Uint8Array) {
  return new Blob([bytes as Uint8Array<ArrayBuffer>]).stream();
}

async function encodeLink(tab: SharedTab): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(tab));
  if (json.length < COMPRESS_FROM || typeof CompressionStream === "undefined")
    return `${SHARED_TAB_PREFIX}j${toBase64Url(json)}`;
  const packed = await readLimited(
    streamOf(json).pipeThrough(new CompressionStream("deflate-raw")),
  );
  return packed
    ? `${SHARED_TAB_PREFIX}z${toBase64Url(packed)}`
    : `${SHARED_TAB_PREFIX}j${toBase64Url(json)}`;
}

type Value = Record<string, unknown>;

const isObject = (value: unknown): value is Value =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isText = (value: unknown, max = 1000): value is string =>
  typeof value === "string" && value.length <= max;
const isOptionalText = (value: unknown, max = 1000) => value === undefined || isText(value, max);

function validConnection(value: unknown): value is SharedConnectionRef {
  return (
    isObject(value) &&
    isText(value.name, 500) &&
    isText(value.kind, 50) &&
    isOptionalText(value.team, 500) &&
    isOptionalText(value.host, 500) &&
    isOptionalText(value.port, 10)
  );
}

function validCondition(value: unknown): value is FilterCondition {
  return (
    isObject(value) &&
    isText(value.id, 200) &&
    isText(value.column, 1000) &&
    isText(value.operator, 50) &&
    isText(value.value, 100_000) &&
    isOptionalText(value.dataType, 200)
  );
}

function validSorting(value: unknown): value is SortingState {
  return (
    Array.isArray(value) &&
    value.length <= 50 &&
    value.every(
      (entry) => isObject(entry) && isText(entry.id, 1000) && typeof entry.desc === "boolean",
    )
  );
}

function validView(value: unknown): value is Partial<SharedView> {
  if (!isObject(value)) return false;
  const allowed = new Set([
    "filter",
    "filterRaw",
    "filterMode",
    "filterConditions",
    "filterCombinator",
    "filterSql",
    "sorting",
  ]);
  return (
    Object.keys(value).every((key) => allowed.has(key)) &&
    isOptionalText(value.filter, 200_000) &&
    (value.filterRaw === undefined || typeof value.filterRaw === "boolean") &&
    (value.filterMode === undefined ||
      value.filterMode === "simple" ||
      value.filterMode === "sql") &&
    (value.filterConditions === undefined ||
      (Array.isArray(value.filterConditions) &&
        value.filterConditions.length <= 500 &&
        value.filterConditions.every(validCondition))) &&
    (value.filterCombinator === undefined ||
      value.filterCombinator === "AND" ||
      value.filterCombinator === "OR") &&
    isOptionalText(value.filterSql, 200_000) &&
    (value.sorting === undefined || validSorting(value.sorting))
  );
}

export function validSharedTab(value: unknown): value is SharedTab {
  if (!isObject(value) || value.v !== 1 || !validConnection(value.connection)) return false;
  if (value.database !== null && !isText(value.database, 1000)) return false;
  if (value.kind === "table")
    return (
      isText(value.schema, 1000) &&
      isText(value.table, 1000) &&
      value.table !== "" &&
      (value.entityType === "table" || value.entityType === "view") &&
      validView(value.view)
    );
  if (value.kind === "query") return isText(value.title, 500) && isText(value.sql, MAX_JSON_BYTES);
  return false;
}

export async function parseSharedTabLink(
  text: string | null | undefined,
): Promise<SharedTab | null> {
  if (!text || text.length > MAX_SHARED_TAB_LINK || !text.includes(SHARED_TAB_PREFIX)) return null;
  const match = LINK_PATTERN.exec(text);
  if (!match) return null;
  try {
    const [format, body] = [match[1][0], match[1].slice(1)];
    let bytes: Uint8Array | null = fromBase64Url(body);
    if (format === "z") {
      if (typeof DecompressionStream === "undefined") return null;
      bytes = await readLimited(
        streamOf(bytes).pipeThrough(new DecompressionStream("deflate-raw")),
      );
    } else if (format !== "j") return null;
    if (!bytes) return null;
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return validSharedTab(value) ? value : null;
  } catch {
    return null;
  }
}

export async function sharedTabLink(tab: SharedTab): Promise<string> {
  const link = await encodeLink(tab);
  if (link.length > MAX_SHARED_TAB_LINK) throw new Error("Tab ist zu groß für einen Link");
  return link;
}

export function effectiveSharedView(view: Partial<SharedView>): Partial<SharedView> {
  if (view.filterMode !== "sql") return view;
  return { ...view, filter: view.filterSql ?? "", filterSql: view.filterSql ?? "" };
}

export interface SharedTabTarget {
  id: string | null;
  certain: boolean;
}

function hostMatch(ref: SharedConnectionRef, other: SharedConnectionRef): "exact" | "loose" | null {
  if (!ref.host || ref.host !== other.host) return null;
  if (ref.port === other.port) return "exact";
  return !ref.port || !other.port ? "loose" : null;
}

export function resolveSharedConnection(
  ref: SharedConnectionRef,
  connections: readonly SavedConnection[],
): SharedTabTarget {
  if (ref.team) {
    const team = connections.filter((connection) => connection.team?.id === ref.team);
    if (team.length === 1) return { id: team[0].id, certain: true };
  }
  const sameKind = connections.filter((connection) => connection.kind === ref.kind);
  const matches = sameKind.map((connection) => hostMatch(ref, connectionRef(connection)));
  const exact = sameKind.filter((_, index) => matches[index] === "exact");
  const hosts = sameKind.filter((_, index) => matches[index] !== null);
  const named = (list: readonly SavedConnection[]) =>
    list.filter((connection) => connection.name.trim() === ref.name.trim());
  if (exact.length === 1 && hosts.length === 1) return { id: exact[0].id, certain: true };
  if (hosts.length > 0)
    return { id: (named(exact)[0] ?? exact[0] ?? named(hosts)[0] ?? hosts[0]).id, certain: false };
  return { id: named(sameKind)[0]?.id ?? null, certain: false };
}

export function sharedTabLabel(tab: SharedTab): string {
  return tab.kind === "table" ? tab.table : tab.title;
}

export function sharedTabSource(tab: SharedTab): string {
  const host = tab.connection.host
    ? tab.connection.host + (tab.connection.port ? `:${tab.connection.port}` : "")
    : null;
  return [tab.connection.name, host, tab.database].filter(Boolean).join(" · ");
}
