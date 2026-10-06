import {
  type DatasetJoin,
  exprRefs,
  JOIN_PREFIX,
  joinId,
  replaceFieldTokens,
  type SimpleDataset,
} from "@/lib/dashboards";
import type { DatabaseKind } from "@/lib/db";
import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";
import type { DatasetColumn } from "../use-dataset-query";

export const JOIN_COLUMN_MIME = "application/x-l8db-join-column";
export const SOURCE_TABLE_MIME = "application/x-l8db-source-table";

export interface StudioNode {
  id: string;
  parent: string | null;
  schema: string;
  table: string;
  join: DatasetJoin | null;
}

export interface JoinColumnDrag {
  node: string;
  column: string;
}

export function studioNodes(simple: SimpleDataset): StudioNode[] {
  if (!simple.table) return [];
  return [
    { id: "", parent: null, schema: simple.schema, table: simple.table, join: null },
    ...(simple.joins ?? []).map((join) => ({
      id: join.id ?? "",
      parent: join.parent ?? "",
      schema: join.schema,
      table: join.table,
      join,
    })),
  ];
}

export function nodeDepth(nodes: StudioNode[], node: StudioNode): number {
  let depth = 0;
  let parent = node.parent;
  while (parent !== null && depth < 8) {
    const found = nodes.find((n) => n.id === parent);
    if (!found) break;
    depth += 1;
    parent = found.parent;
  }
  return depth;
}

export function nodeColumns(columns: DatasetColumn[], node: StudioNode): DatasetColumn[] {
  return columns.filter((column) => column.source === node.id && column.column);
}

export function addJoin(
  simple: SimpleDataset,
  parent: string,
  target: { schema: string; table: string },
  fromColumn: string,
  toColumn: string,
): { simple: SimpleDataset; id: string } {
  const base: DatasetJoin = {
    schema: target.schema,
    table: target.table,
    fromColumn,
    toColumn,
    kind: "left",
    manual: true,
  };
  const parentId = parent || null;
  const id = joinId(parentId, base);
  if ((simple.joins ?? []).some((join) => join.id === id)) return { simple, id };
  return {
    simple: { ...simple, joins: [...(simple.joins ?? []), { ...base, id, parent: parentId }] },
    id,
  };
}

function descendants(joins: DatasetJoin[], id: string): Set<string> {
  const out = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const join of joins)
      if (join.id && join.parent && out.has(join.parent) && !out.has(join.id)) {
        out.add(join.id);
        grew = true;
      }
  }
  return out;
}

function refUses(ref: string | null | undefined, ids: Set<string>): boolean {
  if (!ref?.startsWith(JOIN_PREFIX)) return false;
  const rest = ref.slice(JOIN_PREFIX.length);
  const split = rest.indexOf(":");
  return split > 0 && ids.has(rest.slice(0, split));
}

export function removeJoin(simple: SimpleDataset, id: string): SimpleDataset {
  const joins = simple.joins ?? [];
  const gone = descendants(joins, id);
  const calculated = (simple.calculated ?? []).filter(
    (field) => !exprRefs(field.expr).some((ref) => refUses(ref, gone)),
  );
  const keptCalc = new Set(calculated.map((field) => `calc:${field.id}`));
  const uses = (ref: string | null | undefined) =>
    refUses(ref, gone) || (ref?.startsWith("calc:") === true && !keptCalc.has(ref));
  const metrics = simple.metrics.filter((metric) => !uses(metric.column));
  return {
    ...simple,
    joins: joins.filter((join) => !join.id || !gone.has(join.id)),
    calculated,
    dimension: uses(simple.dimension?.column) ? null : simple.dimension,
    dimension2: uses(simple.dimension2) ? null : simple.dimension2,
    dateColumn: uses(simple.dateColumn) ? null : simple.dateColumn,
    filters: simple.filters.filter((filter) => !uses(filter.column)),
    metrics: metrics.length
      ? metrics
      : [{ id: "count", agg: "count", column: null, label: "Anzahl" }],
  };
}

export function updateJoin(
  simple: SimpleDataset,
  id: string,
  patch: Partial<DatasetJoin>,
): SimpleDataset {
  return {
    ...simple,
    joins: (simple.joins ?? []).map((join) =>
      join.id === id ? { ...join, ...patch, manual: true } : join,
    ),
  };
}

function sampleSql(
  table: string,
  columns: string,
  kind: DatabaseKind | null,
  size: number,
): string {
  if (kind === "mssql") return `SELECT TOP ${size} ${columns} FROM ${table}`;
  if (kind === "oracle") return `SELECT ${columns} FROM ${table} FETCH FIRST ${size} ROWS ONLY`;
  return `SELECT ${columns} FROM ${table} LIMIT ${size}`;
}

export const SAMPLE_SIZE = 500;

export function joinStatsSql(
  kind: DatabaseKind | null,
  parent: { schema: string; table: string },
  child: { schema: string; table: string },
  pairs: { from: string; to: string }[],
): string {
  const valid = pairs.filter((pair) => pair.from && pair.to);
  if (!valid.length || !parent.table || !child.table) return "";
  const style = identifierStyleForKind(kind);
  const q = (name: string) => quoteIdentifier(name, style);
  const table = (t: { schema: string; table: string }) =>
    t.schema ? `${q(t.schema)}.${q(t.table)}` : q(t.table);
  const as = kind === "oracle" ? " " : " AS ";
  const left = [...new Set(valid.map((pair) => pair.from))].map(q).join(", ");
  const right = [...new Set(valid.map((pair) => pair.to))].map(q).join(", ");
  const on = valid.map((pair) => `r.${q(pair.to)} = l.${q(pair.from)}`).join(" AND ");
  return [
    `SELECT COUNT(*)${as}${q("l8_rows")}, SUM(COALESCE(r.${q("l8_hit")}, 0))${as}${q("l8_hits")},`,
    `(SELECT COUNT(*) FROM (${sampleSql(table(parent), `1${as}x`, kind, SAMPLE_SIZE)})${as}s)${as}${q("l8_sample")}`,
    `FROM (${sampleSql(table(parent), left, kind, SAMPLE_SIZE)})${as}l`,
    `LEFT JOIN (SELECT 1${as}${q("l8_hit")}, ${right} FROM ${table(child)})${as}r ON ${on}`,
  ].join("\n");
}

export interface JoinStats {
  sample: number;
  matched: number;
  fanout: number;
}

export function readJoinStats(row: Record<string, unknown> | undefined): JoinStats | null {
  if (!row) return null;
  const rows = Number(row.l8_rows ?? 0);
  const hits = Number(row.l8_hits ?? 0);
  const sample = Number(row.l8_sample ?? 0);
  if (!Number.isFinite(rows) || !Number.isFinite(hits) || !sample) return null;
  const unmatched = Math.max(0, rows - hits);
  const matched = Math.max(0, sample - unmatched);
  return { sample, matched, fanout: matched ? hits / matched : 0 };
}

const AGGREGATE =
  /\b(sum|avg|count|min|max|uniq\w*|any|argMax|argMin|median|quantile\w*|stddev\w*|groupArray)\s*\(/i;

export function looksAggregate(expr: string): boolean {
  return AGGREGATE.test(expr);
}

export function exprToDisplay(expr: string, columns: DatasetColumn[]): string {
  return replaceFieldTokens(expr, (ref) => {
    const field = columns.find((column) => column.ref === ref);
    return `[${field?.label ?? ref}]`;
  });
}

export function exprFromDisplay(display: string, columns: DatasetColumn[]): string {
  return display.replace(/\[([^[\]]+)\]/g, (token, label: string) => {
    const field = columns.find((column) => column.label === label.trim());
    return field && !field.ref.startsWith("calc:") ? `[[${field.ref}]]` : token;
  });
}

export function unknownFields(display: string, columns: DatasetColumn[]): string[] {
  return [...display.matchAll(/\[([^[\]]+)\]/g)]
    .map((match) => match[1].trim())
    .filter((label) => !/^[\d\s,.'"-]*$/.test(label))
    .filter((label) => !columns.some((column) => column.label === label));
}
