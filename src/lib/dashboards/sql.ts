import type { DatabaseKind } from "@/lib/db";
import { identifierStyleForKind, quoteIdentifier, type SqlIdentifierStyle } from "@/lib/export";
import { compileConditionExpression } from "@/lib/sql-filter";
import { aliasOf, datasetJoins, parseRef } from "./joins";
import type { Agg, Dataset, DatasetMetric, Period, SimpleDataset, TimeBucket } from "./model";

export function createId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

export function emptySimple(): SimpleDataset {
  return {
    schema: "",
    table: "",
    join: null,
    joins: [],
    dimension: null,
    dimension2: null,
    metrics: [{ id: createId(), agg: "count", column: null, label: "Anzahl" }],
    filters: [],
    dateColumn: null,
    sort: "dimension",
    limit: 50,
  };
}

export function emptyDataset(name: string): Dataset {
  return {
    id: createId(),
    name,
    mode: "simple",
    simple: emptySimple(),
    sql: "",
    mapping: { dimension: null, dimension2: null, metrics: [], dateColumn: null },
  };
}

export function isNumericType(type: string): boolean {
  return /int|numeric|decimal|float|double|real|money|number|serial/i.test(type);
}

export function isDateType(type: string): boolean {
  return /date|time/i.test(type);
}

function refExpr(ref: string, ds: SimpleDataset, style: SqlIdentifierStyle): string {
  const { join, column } = parseRef(ref, ds);
  const name = quoteIdentifier(column, style);
  const joins = datasetJoins(ds);
  if (joins.length === 0) return name;
  return `${aliasOf(join, joins)}.${name}`;
}

export function bucketExpr(col: string, bucket: TimeBucket, kind: DatabaseKind | null): string {
  if (bucket === "none") return col;
  switch (kind) {
    case "mysql": {
      const map: Record<Exclude<TimeBucket, "none">, string> = {
        day: `DATE(${col})`,
        week: `DATE_SUB(DATE(${col}), INTERVAL WEEKDAY(${col}) DAY)`,
        month: `DATE_FORMAT(${col}, '%Y-%m-01')`,
        quarter: `CONCAT(YEAR(${col}), '-Q', QUARTER(${col}))`,
        year: `DATE_FORMAT(${col}, '%Y-01-01')`,
      };
      return map[bucket];
    }
    case "sqlite":
    case "duckdb": {
      if (kind === "duckdb") return `date_trunc('${bucket}', ${col})`;
      const map: Record<Exclude<TimeBucket, "none">, string> = {
        day: `strftime('%Y-%m-%d', ${col})`,
        week: `strftime('%Y-W%W', ${col})`,
        month: `strftime('%Y-%m', ${col})`,
        quarter: `strftime('%Y', ${col}) || '-Q' || ((CAST(strftime('%m', ${col}) AS INTEGER) + 2) / 3)`,
        year: `strftime('%Y', ${col})`,
      };
      return map[bucket];
    }
    case "mssql":
      if (bucket === "day") return `CAST(${col} AS date)`;
      return `CAST(DATEADD(${bucket}, DATEDIFF(${bucket}, 0, ${col}), 0) AS date)`;
    case "oracle": {
      const fmt = { day: "DD", week: "IW", month: "MM", quarter: "Q", year: "YYYY" }[bucket];
      return `TRUNC(${col}, '${fmt}')`;
    }
    default:
      return `date_trunc('${bucket}', ${col})`;
  }
}

export function aggSql(agg: Agg, col: string): string {
  switch (agg) {
    case "count":
      return `COUNT(${col})`;
    case "count_distinct":
      return `COUNT(DISTINCT ${col})`;
    case "none":
      return col;
    default:
      return `${agg.toUpperCase()}(${col})`;
  }
}

function aggExpr(metric: DatasetMetric, ds: SimpleDataset, style: SqlIdentifierStyle): string {
  return aggSql(metric.agg, metric.column ? refExpr(metric.column, ds, style) : "*");
}

export function periodStart(period: Period, now = new Date()): string | null {
  const d = new Date(now);
  switch (period) {
    case "all":
      return null;
    case "7d":
      d.setDate(d.getDate() - 7);
      break;
    case "30d":
      d.setDate(d.getDate() - 30);
      break;
    case "90d":
      d.setDate(d.getDate() - 90);
      break;
    case "quarter":
      d.setMonth(Math.floor(d.getMonth() / 3) * 3, 1);
      break;
    case "year":
      d.setMonth(0, 1);
      break;
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function dateLiteral(iso: string, kind: DatabaseKind | null): string {
  return kind === "oracle" ? `DATE '${iso}'` : `'${iso}'`;
}

export const DIM_KEY = "dim";
export const DIM2_KEY = "dim2";
export function metricKey(index: number): string {
  return `m${index}`;
}

export function buildSimpleSql(
  ds: SimpleDataset,
  kind: DatabaseKind | null,
  period: Period = "all",
): string {
  if (!ds.table) return "";
  const style = identifierStyleForKind(kind);
  const q = (name: string) => quoteIdentifier(name, style);
  const table = (schema: string, name: string) => (schema ? `${q(schema)}.${q(name)}` : q(name));
  const select: string[] = [];
  const groups: string[] = [];
  if (ds.dimension) {
    const expr = bucketExpr(refExpr(ds.dimension.column, ds, style), ds.dimension.bucket, kind);
    select.push(`${expr} AS ${q(DIM_KEY)}`);
    groups.push(expr);
  }
  if (ds.dimension2) {
    const expr = refExpr(ds.dimension2, ds, style);
    select.push(`${expr} AS ${q(DIM2_KEY)}`);
    groups.push(expr);
  }
  const metrics = ds.metrics.filter((m) => m.agg === "count" || m.column);
  select.push(...metrics.map((m, i) => `${aggExpr(m, ds, style)} AS ${q(metricKey(i))}`));
  if (select.length === 0) select.push("*");
  const grouped =
    metrics.some((m) => m.agg !== "none") &&
    (groups.length > 0 || metrics.some((m) => m.agg === "none" && m.column));
  if (grouped)
    groups.push(
      ...metrics.filter((m) => m.agg === "none" && m.column).map((m) => aggExpr(m, ds, style)),
    );
  const limit = Math.max(1, Math.floor(ds.limit || 50));
  const lines = [`SELECT ${kind === "mssql" ? `TOP ${limit} ` : ""}${select.join(", ")}`];
  const joins = datasetJoins(ds);
  lines.push(`FROM ${table(ds.schema, ds.table)}${joins.length ? " AS t1" : ""}`);
  for (const join of joins) {
    const parent = aliasOf(
      joins.find((j) => j.id === join.parent),
      joins,
    );
    lines.push(
      `LEFT JOIN ${table(join.schema, join.table)} AS ${aliasOf(join, joins)} ON ${aliasOf(join, joins)}.${q(join.toColumn)} = ${parent}.${q(join.fromColumn)}`,
    );
  }
  const where = ds.filters
    .filter((f) => f.column)
    .map((f) =>
      compileConditionExpression(
        refExpr(f.column, ds, style),
        f.operator,
        f.value,
        kind,
        f.dataType,
      ),
    )
    .filter((part): part is string => part !== null);
  const start = periodStart(period);
  if (ds.dateColumn && start)
    where.push(`${refExpr(ds.dateColumn, ds, style)} >= ${dateLiteral(start, kind)}`);
  if (where.length) lines.push(`WHERE ${where.join(" AND ")}`);
  if (grouped) lines.push(`GROUP BY ${groups.join(", ")}`);
  const orderTarget =
    ds.sort === "dimension"
      ? ds.dimension && grouped
        ? q(DIM_KEY)
        : null
      : metrics.length
        ? q(metricKey(0))
        : null;
  if (orderTarget)
    lines.push(`ORDER BY ${orderTarget} ${ds.sort === "metric_desc" ? "DESC" : "ASC"}`);
  if (kind === "oracle") lines.push(`FETCH FIRST ${limit} ROWS ONLY`);
  else if (kind !== "mssql") lines.push(`LIMIT ${limit}`);
  return lines.join("\n");
}

export function buildExpertSql(ds: Dataset, kind: DatabaseKind | null, period: Period): string {
  const sql = ds.sql.trim().replace(/;+\s*$/, "");
  const start = periodStart(period);
  if (!sql || !ds.mapping.dateColumn || !start) return sql;
  const style = identifierStyleForKind(kind);
  const col = quoteIdentifier(ds.mapping.dateColumn, style);
  return `SELECT * FROM (\n${sql}\n) ${kind === "oracle" ? "" : "AS "}q WHERE q.${col} >= ${dateLiteral(start, kind)}`;
}

export function datasetSql(ds: Dataset, kind: DatabaseKind | null, period: Period): string {
  return ds.mode === "simple"
    ? buildSimpleSql(ds.simple, kind, period)
    : buildExpertSql(ds, kind, period);
}
