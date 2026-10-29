import { createContext, useMemo } from "react";
import type { SavedConnection } from "@/lib/connections/types";
import type { DetailedColumnInfo } from "@/lib/db";
import type { TableColumnPref } from "@/lib/table-column-prefs/types";
import type { CellProps, ColumnInfo, ColumnPatch, Row, TableInfo } from "./api";
import { columnInfos, tableInfo } from "./info";
import type { PluginNode, UiPluginRegistry } from "./registry";
import { freezeRow, freezeRows } from "./rows";
import { useUiPluginRegistry } from "./store";
import { TONE_COLORS } from "./tones";

export type UiPluginGrid = {
  table: TableInfo;
  cell:
    | ((value: unknown, row: Row, columnId: string, rowIndex: number) => PluginNode | undefined)
    | null;
  rowColor: ((row: Row) => string | undefined) | null;
  layout: TableColumnPref | undefined;
  widths: Readonly<Record<string, number>> | undefined;
  labels: Readonly<Record<string, string>> | undefined;
  align: Readonly<Record<string, "start" | "center" | "end">> | undefined;
};

export const UiPluginGridContext = createContext<UiPluginGrid | null>(null);

export function columnDefaults(patches: readonly ColumnPatch[]) {
  if (patches.length === 0) return {};
  const ordered = patches
    .filter((patch) => patch.order !== undefined)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((patch) => patch.id);
  const hidden = patches.filter((patch) => patch.hidden).map((patch) => patch.id);
  const pinnedIds = patches.filter((patch) => patch.pinned).map((patch) => patch.id);
  const pinned = [
    ...ordered.filter((id) => pinnedIds.includes(id)),
    ...pinnedIds.filter((id) => !ordered.includes(id)),
  ];
  const pick = <K extends "width" | "label" | "align">(key: K) => {
    const entries = patches.flatMap((patch) =>
      patch[key] === undefined ? [] : [[patch.id, patch[key]] as const],
    );
    return entries.length
      ? (Object.fromEntries(entries) as Record<string, NonNullable<ColumnPatch[K]>>)
      : undefined;
  };
  return {
    layout:
      ordered.length || hidden.length || pinned.length
        ? { order: ordered, hidden, pinned }
        : undefined,
    widths: pick("width"),
    labels: pick("label"),
    align: pick("align"),
  };
}

type ColumnDefaults = ReturnType<typeof columnDefaults>;

class CellSource implements Omit<CellProps, "options"> {
  constructor(
    readonly value: unknown,
    readonly row: Row,
    readonly column: ColumnInfo,
    readonly table: TableInfo,
    readonly rowIndex: number,
    private readonly lazyRows: () => readonly Row[],
  ) {}

  get rows() {
    return this.lazyRows();
  }
}

export function createPluginGrid(
  registry: Pick<UiPluginRegistry, "cell" | "rowTone">,
  table: TableInfo,
  infos: readonly ColumnInfo[],
  rows: readonly Row[],
  defaults: ColumnDefaults,
): UiPluginGrid {
  const { cell, rowTone } = registry;
  const byId = new Map(infos.map((info) => [info.id, info]));
  let all: readonly Row[] | null = null;
  const lazyRows = () => (all ??= freezeRows(rows));
  return {
    table,
    cell: cell
      ? (value, row, columnId, rowIndex) => {
          const column = byId.get(columnId);
          if (!column) return undefined;
          const copy = freezeRow(row);
          const own = Object.hasOwn(copy, columnId) ? copy[columnId] : value;
          return cell(new CellSource(own, copy, column, table, rowIndex, lazyRows));
        }
      : null,
    rowColor: rowTone
      ? (row) => {
          const tone = rowTone(freezeRow(row), table);
          return tone ? TONE_COLORS[tone] : undefined;
        }
      : null,
    layout: defaults.layout,
    widths: defaults.widths,
    labels: defaults.labels,
    align: defaults.align,
  };
}

export function usePluginGrid(
  connection: SavedConnection | null | undefined,
  database: string | null | undefined,
  schema: string,
  table: string,
  isView: boolean,
  columns: readonly string[],
  details: readonly DetailedColumnInfo[] | undefined,
  rows: readonly Row[],
): UiPluginGrid | null {
  const cell = useUiPluginRegistry((registry) => registry.cell);
  const rowTone = useUiPluginRegistry((registry) => registry.rowTone);
  const patches = useUiPluginRegistry((registry) => registry.columns);
  const tableSlots = useUiPluginRegistry((registry) => !!(registry.toolbar || registry.detailTabs));
  const active = !!connection && !!(cell || rowTone || patches || tableSlots);
  const info = useMemo(
    () => (active && connection ? tableInfo(connection, database, schema, table, isView) : null),
    [active, connection, database, schema, table, isView],
  );
  const infos = useMemo(
    () => (info ? columnInfos(columns, details) : null),
    [info, columns, details],
  );
  const defaults = useMemo(
    () => (info && infos && patches ? columnDefaults(patches(info, infos)) : {}),
    [info, infos, patches],
  );
  return useMemo(
    () => (info && infos ? createPluginGrid({ cell, rowTone }, info, infos, rows, defaults) : null),
    [info, infos, rows, defaults, cell, rowTone],
  );
}
