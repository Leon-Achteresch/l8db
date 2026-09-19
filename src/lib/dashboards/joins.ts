import type { ForeignKeyInfo } from "@/lib/db";
import type { DatasetJoin, SimpleDataset } from "./model";

export const JOIN_PREFIX = "join:";

const LEGACY_JOIN = "legacy";

export function joinRef(joinId: string, column: string): string {
  return `${JOIN_PREFIX}${joinId}:${column}`;
}

export function joinId(parent: string | null, join: DatasetJoin): string {
  return `${parent ? `${parent}>` : ""}${join.schema}.${join.table}.${join.fromColumn}.${join.toColumn}`.replace(
    /:/g,
    "_",
  );
}

export function datasetJoins(ds: SimpleDataset): DatasetJoin[] {
  return [...(ds.join ? [{ ...ds.join, id: LEGACY_JOIN, parent: null }] : []), ...(ds.joins ?? [])];
}

export function parseRef(
  ref: string,
  ds: SimpleDataset,
): { join: DatasetJoin | null; column: string } {
  if (!ref.startsWith(JOIN_PREFIX)) return { join: null, column: ref };
  const rest = ref.slice(JOIN_PREFIX.length);
  const split = rest.indexOf(":");
  const joins = datasetJoins(ds);
  const byId = split > 0 ? joins.find((j) => j.id === rest.slice(0, split)) : undefined;
  if (byId) return { join: byId, column: rest.slice(split + 1) };
  return { join: joins.find((j) => j.id === LEGACY_JOIN) ?? null, column: rest };
}

function refJoinId(ref: string): string | null {
  if (!ref.startsWith(JOIN_PREFIX)) return null;
  const rest = ref.slice(JOIN_PREFIX.length);
  const split = rest.indexOf(":");
  return split > 0 ? rest.slice(0, split) : null;
}

function datasetRefs(ds: SimpleDataset): string[] {
  return [
    ds.dimension?.column,
    ds.dimension2,
    ds.dateColumn,
    ...ds.metrics.map((m) => m.column),
    ...ds.filters.map((f) => f.column),
  ].filter((ref): ref is string => Boolean(ref));
}

export function syncJoins(
  ds: SimpleDataset,
  options: DatasetJoin[],
  extraRefs: string[] = [],
): SimpleDataset {
  const known = new Map([...options, ...(ds.joins ?? [])].map((j) => [j.id, j]));
  const needed: DatasetJoin[] = [];
  const add = (id: string, depth = 0) => {
    const join = known.get(id);
    if (!join || depth > 8 || needed.includes(join)) return;
    if (join.parent) add(join.parent, depth + 1);
    needed.push(join);
  };
  for (const ref of [...datasetRefs(ds), ...extraRefs]) {
    const id = refJoinId(ref);
    if (id) add(id);
  }
  return { ...ds, joins: needed };
}

export interface JoinOption {
  join: DatasetJoin & { id: string };
  label: string;
}

const MAX_JOIN_OPTIONS = 40;

export function joinOptions(
  schema: string,
  table: string,
  foreignKeys: ForeignKeyInfo[],
): JoinOption[] {
  const constraintOf = (fk: ForeignKeyInfo) =>
    `${fk.from_schema}.${fk.from_table}.${fk.constraint_name}`;
  const columnsOf = new Map<string, Set<string>>();
  for (const fk of foreignKeys) {
    const cols = columnsOf.get(constraintOf(fk)) ?? new Set<string>();
    columnsOf.set(constraintOf(fk), cols.add(fk.from_column));
  }
  const seen = new Set<string>();
  const fks = foreignKeys.filter((fk) => {
    if (seen.has(constraintOf(fk))) return false;
    seen.add(constraintOf(fk));
    return columnsOf.get(constraintOf(fk))?.size === 1;
  });
  const out: (JoinOption & { base: string })[] = [];
  const push = (parent: JoinOption | null, join: DatasetJoin, base: string) => {
    const id = joinId(parent?.join.id ?? null, join);
    if (out.some((o) => o.join.id === id)) return;
    out.push({
      join: { ...join, id, parent: parent?.join.id ?? null },
      label: parent ? `${parent.label} → ${base}` : base,
      base,
    });
  };
  const isFrom = (fk: ForeignKeyInfo, s: string, t: string) =>
    fk.from_schema === s && fk.from_table === t;
  const isTo = (fk: ForeignKeyInfo, s: string, t: string) =>
    fk.to_schema === s && fk.to_table === t;
  const forward = (fk: ForeignKeyInfo): DatasetJoin => ({
    schema: fk.to_schema,
    table: fk.to_table,
    fromColumn: fk.from_column,
    toColumn: fk.to_column,
  });
  for (const fk of fks.filter((fk) => isFrom(fk, schema, table)))
    push(null, forward(fk), fk.to_table);
  const direct = [...out];
  for (const fk of fks.filter((fk) => isTo(fk, schema, table) && !isFrom(fk, schema, table)))
    push(
      null,
      {
        schema: fk.from_schema,
        table: fk.from_table,
        fromColumn: fk.to_column,
        toColumn: fk.from_column,
      },
      fk.from_table,
    );
  for (const parent of direct)
    for (const fk of fks.filter(
      (fk) =>
        isFrom(fk, parent.join.schema, parent.join.table) &&
        !isTo(fk, schema, table) &&
        !isTo(fk, parent.join.schema, parent.join.table),
    ))
      push(parent, forward(fk), fk.to_table);
  const counts = new Map<string, number>();
  for (const o of out) counts.set(o.label, (counts.get(o.label) ?? 0) + 1);
  return out.slice(0, MAX_JOIN_OPTIONS).map(({ join, label }) => ({
    join,
    label: (counts.get(label) ?? 0) > 1 ? `${label} (über ${join.fromColumn})` : label,
  }));
}

export function refLabel(ref: string, ds: SimpleDataset): string {
  const { join, column } = parseRef(ref, ds);
  return join ? `${join.table}.${column}` : column;
}

export function aliasOf(join: DatasetJoin | null | undefined, joins: DatasetJoin[]): string {
  const index = join ? joins.findIndex((j) => j.id === join.id) : -1;
  return index < 0 ? "t1" : `t${index + 2}`;
}
