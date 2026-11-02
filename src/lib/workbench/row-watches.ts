import { saveWorkbenchRecord, type WorkbenchRecord } from "./records";

export interface RowWatch {
  keys: string[];
  identity: string;
  cells: Record<string, string>;
}
export const WATCH_MAX_COLUMNS = 200;
export function watchKey(row: Record<string, unknown>, keys: string[]): string | null {
  if (!keys.length || keys.some((key) => row[key] == null)) return null;
  try {
    return encodeCell(keys.map((key) => [key, row[key]]));
  } catch {
    return null;
  }
}
function encodeCell(value: unknown): string {
  let chars = 0;
  let nodes = 0;
  return JSON.stringify(value ?? null, (key, item: unknown) => {
    chars += key.length + (typeof item === "string" ? item.length : 0);
    if (++nodes > 10_000 || chars > 50_000)
      throw new Error("Dieser Zellwert ist zu groß zum Beobachten.");
    return typeof item === "bigint" ? item.toString() : item;
  });
}
function sameCell(value: unknown, saved: string) {
  try {
    return encodeCell(value) === saved;
  } catch {
    return false;
  }
}
export function displayCurrentWatchedCell(value: unknown) {
  try {
    return displayWatchedCell(encodeCell(value));
  } catch {
    return "Wert zu groß oder nicht vergleichbar";
  }
}

export function watchSnapshot(
  row: Record<string, unknown>,
  keys: string[],
  columns: string[],
): RowWatch {
  const identity = watchKey(row, keys);
  if (!identity)
    throw new Error("Zum Beobachten wird ein vollständig geladener Primärschlüssel benötigt.");
  if (columns.length > WATCH_MAX_COLUMNS)
    throw new Error("Es können höchstens 200 Spalten beobachtet werden.");
  const cells: [string, string][] = [];
  let chars = identity.length;
  for (const column of columns) {
    if (!Object.hasOwn(row, column) || column.startsWith("__")) continue;
    const value = encodeCell(row[column]);
    chars += column.length + value.length;
    if (chars > 50_000)
      throw new Error("Dieser Datensatz ist zu groß zum Beobachten (maximal 50.000 Zeichen).");
    cells.push([column, value]);
  }
  return { identity, keys, cells: Object.fromEntries(cells) };
}
export function saveRowWatch(
  scope: string,
  row: Record<string, unknown>,
  keys: string[],
  columns: string[],
) {
  const value = watchSnapshot(row, keys, columns);
  const name = keys
    .map((key) => `${key}=${String(row[key])}`)
    .join(", ")
    .slice(0, 80);
  return saveWorkbenchRecord({
    id: `watch:${scope}:${value.identity}`,
    kind: "watch",
    scope,
    name,
    value,
  });
}
export interface WatchedRowState {
  watch: WorkbenchRecord<RowWatch>;
  row: Record<string, unknown> | null;
  changed: string[];
}
export function compareWatchedRows(
  watches: WorkbenchRecord<RowWatch>[],
  rows: Record<string, unknown>[],
): WatchedRowState[] {
  if (!watches.length) return [];
  const groups = new Map<
    string,
    { keys: string[]; rows: Map<string, Record<string, unknown> | null> }
  >();
  for (const watch of watches) {
    const groupKey = JSON.stringify(watch.value.keys);
    let group = groups.get(groupKey);
    if (!group) {
      group = { keys: watch.value.keys, rows: new Map() };
      groups.set(groupKey, group);
    }
    group.rows.set(watch.value.identity, null);
  }
  for (const group of groups.values()) {
    for (const row of rows) {
      const identity = watchKey(row, group.keys);
      if (identity !== null && group.rows.has(identity)) group.rows.set(identity, row);
    }
  }
  return watches.map((watch) => {
    const row =
      groups.get(JSON.stringify(watch.value.keys))?.rows.get(watch.value.identity) ?? null;
    const changed = row
      ? Object.entries(watch.value.cells)
          .filter(([column, value]) => Object.hasOwn(row, column) && !sameCell(row[column], value))
          .map(([column]) => column)
      : [];
    return { watch, row, changed };
  });
}
export function displayWatchedCell(value: string = "null") {
  return value.length > 120 ? `${value.slice(0, 120)}…` : value;
}
