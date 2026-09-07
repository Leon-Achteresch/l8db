import type { ERSchema, ERTable, ForeignKeyInfo } from "@/lib/db";

export const ER_FOCUS_DEPTHS = [0, 1, 2] as const;

export type ErFocusDepth = (typeof ER_FOCUS_DEPTHS)[number];

export interface ErFocus {
  schema: string;
  table: string;
  depth: ErFocusDepth;
}

export const EMPTY_ER_SCHEMA: ERSchema = { tables: [], foreign_keys: [] };

export function erTableKey(schema: string, name: string): string {
  return `${schema}.${name}`;
}

export function erTableKeyOf(table: ERTable): string {
  return erTableKey(table.schema, table.name);
}

export function parseErFocusDepth(value: unknown): ErFocusDepth {
  const numeric = typeof value === "string" ? Number(value) : value;
  if (numeric === 0) return 0;
  if (numeric === 2) return 2;
  return 1;
}

export function parseErFocus(search: {
  focusSchema?: unknown;
  focusTable?: unknown;
  depth?: unknown;
}): ErFocus | null {
  const schema = typeof search.focusSchema === "string" ? search.focusSchema : "";
  const table = typeof search.focusTable === "string" ? search.focusTable : "";
  if (!schema || !table) return null;
  return { schema, table, depth: parseErFocusDepth(search.depth) };
}

function adjacency(foreignKeys: ForeignKeyInfo[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    if (from === to) return;
    const entry = map.get(from);
    if (entry) entry.add(to);
    else map.set(from, new Set([to]));
  };
  for (const fk of foreignKeys) {
    const from = erTableKey(fk.from_schema, fk.from_table);
    const to = erTableKey(fk.to_schema, fk.to_table);
    link(from, to);
    link(to, from);
  }
  return map;
}

export function erFocusTableKeys(schema: ERSchema, focus: ErFocus): string[] {
  const available = new Set(schema.tables.map(erTableKeyOf));
  const start = erTableKey(focus.schema, focus.table);
  if (!available.has(start)) return [];
  const neighbors = adjacency(schema.foreign_keys);
  const visited = new Set<string>([start]);
  const ordered = [start];
  let frontier = [start];
  for (let depth = 0; depth < focus.depth; depth++) {
    const next: string[] = [];
    for (const key of frontier) {
      for (const neighbor of neighbors.get(key) ?? []) {
        if (visited.has(neighbor) || !available.has(neighbor)) continue;
        visited.add(neighbor);
        ordered.push(neighbor);
        next.push(neighbor);
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }
  return ordered;
}

export function erFocusExists(schema: ERSchema, focus: ErFocus | null): boolean {
  if (!focus) return true;
  const start = erTableKey(focus.schema, focus.table);
  return schema.tables.some((table) => erTableKeyOf(table) === start);
}

export function filterErSchema(schema: ERSchema, focus: ErFocus | null): ERSchema {
  if (!focus) return schema;
  const keys = new Set(erFocusTableKeys(schema, focus));
  if (keys.size === 0) return EMPTY_ER_SCHEMA;
  const seen = new Set<string>();
  const tables: ERTable[] = [];
  for (const table of schema.tables) {
    const key = erTableKeyOf(table);
    if (!keys.has(key) || seen.has(key)) continue;
    seen.add(key);
    tables.push(table);
  }
  const foreign_keys = schema.foreign_keys.filter(
    (fk) =>
      keys.has(erTableKey(fk.from_schema, fk.from_table)) &&
      keys.has(erTableKey(fk.to_schema, fk.to_table)),
  );
  return { tables, foreign_keys };
}
