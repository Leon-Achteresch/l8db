import { squarify } from "@/features/dashboard/charts/svg-geometry";
import type { DatabaseOverview, SchemaMap, SchemaMapLink, TableInfo } from "@/lib/db";

export const ATLAS_TILE_LIMIT = 180;
export const ATLAS_GRID_LIMIT = 24;
export const ATLAS_GRID_ROW = 72;
const ATLAS_GRID_COLS = 4;

export type AtlasMetric = "bytes" | "rows" | "links" | null;

export interface AtlasTable {
  schema: string;
  name: string;
  rows: number | null;
  bytes: number | null;
  comment: string | null;
  links: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasTile extends AtlasTable, Rect {
  key: string;
  heat: number;
}

export interface AtlasLayout {
  tiles: AtlasTile[];
  matching: number;
  hidden: number;
  metric: AtlasMetric;
}

export interface AtlasNeighbors {
  outgoing: string[];
  incoming: string[];
}

export function atlasKey(schema: string, name: string): string {
  return `${schema}\u001f${name}`;
}

export function splitAtlasKey(key: string): [string, string] {
  const at = key.indexOf("\u001f");
  return [key.slice(0, at), key.slice(at + 1)];
}

export function joinAtlas(tables: TableInfo[], map: SchemaMap | undefined): AtlasTable[] {
  const stats = new Map(map?.tables?.map((table) => [table.name, table]));
  const schema = tables[0]?.schema;
  const degree = new Map<string, number>();
  for (const { from, to } of map?.links ?? []) {
    if (from[0] === to[0] && from[1] === to[1]) continue;
    if (from[0] === schema) degree.set(from[1], (degree.get(from[1]) ?? 0) + 1);
    if (to[0] === schema) degree.set(to[1], (degree.get(to[1]) ?? 0) + 1);
  }
  return tables.map((table) => {
    const stat = stats.get(table.name);
    return {
      schema: table.schema,
      name: table.name,
      rows: stat?.rows ?? null,
      bytes: stat?.bytes ?? null,
      comment: stat?.comment ?? null,
      links: table.schema === schema ? (degree.get(table.name) ?? 0) : 0,
    };
  });
}

export function atlasMetric(tables: AtlasTable[]): AtlasMetric {
  if (tables.some((table) => (table.bytes ?? 0) > 0)) return "bytes";
  if (tables.some((table) => (table.rows ?? 0) > 0)) return "rows";
  if (tables.some((table) => table.links > 0)) return "links";
  return null;
}

export function atlasGrid(
  count: number,
  metric: AtlasMetric,
): { cols: number; rows: number } | null {
  if (metric === "bytes" || metric === "rows" || count < 1 || count > ATLAS_GRID_LIMIT) return null;
  const cols = Math.min(count, ATLAS_GRID_COLS);
  return { cols, rows: Math.ceil(count / cols) };
}

export interface RankedSchema {
  name: string;
  bytes: number | null;
  tables: number | null;
  share: number;
}

export function rankSchemas(
  names: string[],
  overview: DatabaseOverview | undefined,
): RankedSchema[] {
  const sized = (overview?.size_bytes ?? 0) > 0;
  const stats = new Map(overview?.schemas.map((entry) => [entry.schema, entry]));
  const entries = names.map((name) => ({
    name,
    bytes: sized ? (stats.get(name)?.size_bytes ?? null) : null,
    tables: stats.get(name)?.table_count ?? null,
  }));
  const measure = (entry: (typeof entries)[number]) => (sized ? entry.bytes : entry.tables) ?? -1;
  entries.sort((a, b) => measure(b) - measure(a) || a.name.localeCompare(b.name));
  const largest = Math.max(1, measure(entries[0] ?? { name: "", bytes: null, tables: null }));
  return entries.map((entry) => ({ ...entry, share: Math.max(0, measure(entry)) / largest }));
}

function sizeOf(table: AtlasTable, metric: AtlasMetric): number {
  if (metric === "links") return table.links;
  return (metric === "bytes" ? table.bytes : metric === "rows" ? table.rows : 0) ?? 0;
}

export function layoutAtlas(
  tables: AtlasTable[],
  width: number,
  height: number,
  query = "",
  limit = ATLAS_TILE_LIMIT,
): AtlasLayout {
  const metric = atlasMetric(tables);
  const needle = query.trim().toLowerCase();
  const unit = metric === "bytes" ? 8192 : 1;
  let largest = 0;
  const weighted: { table: AtlasTable; size: number; weight: number }[] = [];
  for (const table of tables) {
    const size = sizeOf(table, metric);
    if (size > largest) largest = size;
    if (!needle || table.name.toLowerCase().includes(needle))
      weighted.push({ table, size, weight: 1 + Math.log1p(size / unit) });
  }
  weighted.sort(
    (a, b) =>
      b.weight - a.weight ||
      (a.table.name < b.table.name ? -1 : a.table.name > b.table.name ? 1 : 0),
  );
  const shown = weighted.slice(0, limit).map((entry) => ({ ...entry, value: entry.weight }));
  const grid = atlasGrid(shown.length, metric);
  const cells = grid
    ? width > 0 && height > 0
      ? shown.map((item, index) => ({
          item,
          x: (index % grid.cols) * (width / grid.cols),
          y: Math.floor(index / grid.cols) * (height / grid.rows),
          width: width / grid.cols,
          height: height / grid.rows,
        }))
      : []
    : squarify(shown, 0, 0, width, height);
  return {
    tiles: cells.map(({ item, x, y, width: w, height: h }) => ({
      ...item.table,
      x,
      y,
      w,
      h,
      key: atlasKey(item.table.schema, item.table.name),
      heat: largest > 0 ? Math.sqrt(item.size / largest) : 0,
    })),
    matching: weighted.length,
    hidden: weighted.length - shown.length,
    metric,
  };
}

export function atlasNeighbors(links: SchemaMapLink[], key: string): AtlasNeighbors {
  const [schema, name] = splitAtlasKey(key);
  const outgoing = new Set<string>();
  const incoming = new Set<string>();
  for (const link of links) {
    if (link.from[1] === name && link.from[0] === schema) {
      const to = atlasKey(link.to[0], link.to[1]);
      if (to !== key) outgoing.add(to);
    } else if (link.to[1] === name && link.to[0] === schema) {
      incoming.add(atlasKey(link.from[0], link.from[1]));
    }
  }
  return { outgoing: [...outgoing], incoming: [...incoming] };
}

export type AtlasDirection = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown";

export function nextAtlasTile(tiles: Rect[], from: number, direction: AtlasDirection): number {
  const origin = tiles[from];
  if (!origin) return from;
  const cx = origin.x + origin.w / 2;
  const cy = origin.y + origin.h / 2;
  const horizontal = direction === "ArrowLeft" || direction === "ArrowRight";
  const sign = direction === "ArrowRight" || direction === "ArrowDown" ? 1 : -1;
  let best = from;
  let bestScore = Number.POSITIVE_INFINITY;
  tiles.forEach((tile, index) => {
    if (index === from) return;
    const dx = tile.x + tile.w / 2 - cx;
    const dy = tile.y + tile.h / 2 - cy;
    const forward = (horizontal ? dx : dy) * sign;
    if (forward <= 0.5) return;
    const score = forward + Math.abs(horizontal ? dy : dx) * 2;
    if (score < bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return best;
}
