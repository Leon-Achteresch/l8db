import type { ForeignKeyInfo, TableInfo } from "@/lib/db";
import { quoteIdent } from "./hover";
import { eq } from "./resolve";
import type { JoinTarget, TableRef } from "./scope";
import type { SqlObjectRegistry, Suggestion } from "./types";

export const MAX_JOIN_TABLES = 8;

function resolveTable(registry: SqlObjectRegistry, ref: TableRef): TableInfo | null {
  if (ref.columns) return null;
  const match = (table: TableInfo) =>
    eq(table.name, ref.name) && (!ref.schema || eq(table.schema, ref.schema));
  return registry.tables.find(match) ?? null;
}

export function joinTables(registry: SqlObjectRegistry, join: JoinTarget): TableInfo[] {
  const target = resolveTable(registry, join.ref);
  const others = join.others.flatMap((ref) => resolveTable(registry, ref) ?? []);
  if (!target || others.length === 0) return [];
  const unique = new Map<string, TableInfo>();
  for (const table of [target, ...others])
    unique.set(`${table.schema}\u0000${table.name}`.toLowerCase(), table);
  return [...unique.values()].slice(0, MAX_JOIN_TABLES);
}

const normalize = (text: string) => text.replace(/["`[\]\s]/g, "").toLowerCase();

export function joinSuggestions(
  registry: SqlObjectRegistry,
  join: JoinTarget,
  foreignKeys: ForeignKeyInfo[],
): Suggestion[] {
  const target = resolveTable(registry, join.ref);
  if (!target || foreignKeys.length === 0) return [];
  const dialect = registry.dialect;
  const groups = new Map<string, { fk: ForeignKeyInfo; pairs: [string, string][] }>();
  for (const fk of foreignKeys) {
    const key = [fk.constraint_name, fk.from_schema, fk.from_table, fk.to_schema, fk.to_table]
      .join("\u0000")
      .toLowerCase();
    let group = groups.get(key);
    if (!group) {
      group = { fk, pairs: [] };
      groups.set(key, group);
    }
    if (!group.pairs.some(([from, to]) => from === fk.from_column && to === fk.to_column))
      group.pairs.push([fk.from_column, fk.to_column]);
  }
  const is = (table: TableInfo, schema: string, name: string) =>
    eq(table.schema, schema) && eq(table.name, name);
  const column = (name: string) => quoteIdent(name, dialect);
  const existing = normalize(join.condition);
  const listed = new Set(existing.split(","));
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const other of join.others) {
    const table = resolveTable(registry, other);
    if (!table) continue;
    for (const { fk, pairs } of groups.values()) {
      const directions: [string, string][][] = [];
      if (is(target, fk.from_schema, fk.from_table) && is(table, fk.to_schema, fk.to_table))
        directions.push(pairs);
      if (is(table, fk.from_schema, fk.from_table) && is(target, fk.to_schema, fk.to_table))
        directions.push(pairs.map(([from, to]): [string, string] => [to, from]));
      for (const columns of directions) {
        let text: string;
        if (join.using) {
          if (!columns.every(([own, foreign]) => eq(own, foreign))) continue;
          const names = columns.map(([own]) => column(own));
          if (names.every((name) => listed.has(normalize(name)))) continue;
          text = names.join(", ");
        } else {
          const left = join.ref.qualifier;
          const right = other.qualifier;
          const parts = columns.map(([own, foreign]) => ({
            part: `${left}.${column(own)} = ${right}.${column(foreign)}`,
            mirror: `${right}.${column(foreign)} = ${left}.${column(own)}`,
          }));
          const present = parts.every(
            ({ part, mirror }) =>
              existing.includes(normalize(part)) || existing.includes(normalize(mirror)),
          );
          if (present) continue;
          text = parts.map(({ part }) => part).join(" AND ");
        }
        if (seen.has(text)) continue;
        seen.add(text);
        out.push({
          label: text,
          kind: "join",
          detail: fk.constraint_name,
          documentation: `${fk.from_schema}.${fk.from_table} → ${fk.to_schema}.${fk.to_table}`,
          insertText: text,
          sortText: `0!${String(out.length).padStart(4, "0")}`,
        });
      }
    }
  }
  return out;
}
