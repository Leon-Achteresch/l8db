import type { DatabaseKind } from "@/lib/db";
import { identifierStyleForKind, quoteIdentifier, type SqlIdentifierStyle } from "@/lib/export";
import { compileConditionExpression, operatorNeedsList, parseFilterList } from "@/lib/sql-filter";
import { quoteString } from "@/lib/sql-filter/quote";
import { aliasOf, calcOf, datasetJoins, parseRef, replaceFieldTokens } from "./joins";
import {
  type Agg,
  type CompareMode,
  CROSS_WHERE,
  type CrossCondition,
  type Dataset,
  type DatasetMetric,
  type Period,
  type SimpleDataset,
  type TimeBucket,
} from "./model";
import { serverSqlParts } from "./sql-tables";
import {
  EMPTY_SCOPE,
  filterVariable,
  neutralBackslashes,
  scopeValue,
  substituteVariables,
  type VariableScope,
} from "./variables";

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

function refExpr(ref: string, ds: SimpleDataset, style: SqlIdentifierStyle, depth = 0): string {
  const calc = calcOf(ref, ds);
  if (calc)
    return depth > 4
      ? "NULL"
      : `(${replaceFieldTokens(calc.expr.trim() || "NULL", (inner) => refExpr(inner, ds, style, depth + 1))})`;
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

function aggregatedCalc(metric: DatasetMetric, ds: SimpleDataset): boolean {
  return Boolean(metric.column && calcOf(metric.column, ds)?.aggregate);
}

function aggExpr(metric: DatasetMetric, ds: SimpleDataset, style: SqlIdentifierStyle): string {
  if (aggregatedCalc(metric, ds)) return refExpr(metric.column ?? "", ds, style);
  return aggSql(metric.agg, metric.column ? refExpr(metric.column, ds, style) : "*");
}

function summarizes(metric: DatasetMetric, ds: SimpleDataset): boolean {
  return metric.agg !== "none" || aggregatedCalc(metric, ds);
}

function isoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(date.getDate(), last));
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() + days);
  return d;
}

function periodStartDate(period: Period, now: Date): Date | null {
  switch (period) {
    case "all":
      return null;
    case "7d":
      return addDays(now, -7);
    case "30d":
      return addDays(now, -30);
    case "90d":
      return addDays(now, -90);
    case "12m":
      return new Date(now.getFullYear(), now.getMonth() - 11, 1);
    case "quarter":
      return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    case "year":
      return new Date(now.getFullYear(), 0, 1);
  }
}

export function periodStart(period: Period, now = new Date()): string | null {
  const start = periodStartDate(period, now);
  return start ? isoDate(start) : null;
}

export function periodProgress(period: Period, now = new Date()): number | null {
  if (period !== "quarter" && period !== "year") return null;
  const start = periodStartDate(period, now) as Date;
  const end = addMonths(start, period === "year" ? 12 : 3);
  return (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
}

export interface DateRange {
  start: string | null;
  end: string | null;
}

export function periodRange(period: Period, now = new Date()): DateRange {
  return { start: periodStart(period, now), end: null };
}

function shiftBack(date: Date, period: Exclude<Period, "all">, compare: CompareMode): Date {
  if (compare === "year") return addMonths(date, -12);
  switch (period) {
    case "7d":
      return addDays(date, -8);
    case "30d":
      return addDays(date, -31);
    case "90d":
      return addDays(date, -91);
    case "quarter":
      return addMonths(date, -3);
    default:
      return addMonths(date, -12);
  }
}

export function comparisonRange(
  period: Period,
  compare: CompareMode,
  now = new Date(),
): DateRange | null {
  const start = periodStartDate(period, now);
  if (!start || period === "all" || compare === "none") return null;
  return {
    start: isoDate(shiftBack(start, period, compare)),
    end: isoDate(shiftBack(addDays(now, 1), period, compare)),
  };
}

function rangeConditions(column: string, range: DateRange, kind: DatabaseKind | null): string[] {
  return [
    ...(range.start ? [`${column} >= ${dateLiteral(range.start, kind)}`] : []),
    ...(range.end ? [`${column} < ${dateLiteral(range.end, kind)}`] : []),
  ];
}

export function dateLiteral(iso: string, kind: DatabaseKind | null): string {
  return kind === "oracle" ? `DATE '${iso}'` : `'${iso}'`;
}

const ISO_DATE =
  /^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?(?:Z|[+-]\d{2}(?::?\d{2})?)?$/;

export function crossLiteral(
  value: unknown,
  kind: DatabaseKind | null,
  temporal = false,
): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "bigint") return String(value);
  if (typeof value === "boolean")
    return kind === "mssql" || kind === "oracle" ? (value ? "1" : "0") : String(value);
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (kind === "oracle" && temporal && ISO_DATE.test(text)) {
    const time = text.slice(11, 19);
    return time && time !== "00:00:00" && time.length === 8
      ? `TIMESTAMP '${text.slice(0, 10)} ${time}'`
      : `DATE '${text.slice(0, 10)}'`;
  }
  return quoteString(neutralBackslashes(text, kind), kind ?? undefined);
}

function equalsLiteral(expr: string, literal: string | null): string {
  return literal === null ? "1 = 0" : `${expr} = ${literal}`;
}

function listLiterals(values: unknown[], kind: DatabaseKind | null, temporal: boolean): string[] {
  const literals = values
    .map((entry) => crossLiteral(entry, kind, temporal))
    .filter((literal): literal is string => literal !== null);
  return literals.length ? [literals.join(", ")] : [];
}

export function crossListCondition(
  expr: string,
  values: unknown[],
  kind: DatabaseKind | null,
  temporal = false,
): string {
  const present = values.filter((entry) => entry !== null && entry !== undefined);
  const list = present.length
    ? listLiterals(present, kind, temporal)
        .map((literals) => `${expr} IN (${literals})`)
        .join("")
    : "";
  const nulls = present.length < values.length ? `${expr} IS NULL` : "";
  if (list && nulls) return `(${list} OR ${nulls})`;
  return list || nulls || "1 = 0";
}

function compileCross(
  expr: string,
  cross: CrossCondition,
  kind: DatabaseKind | null,
  temporal: boolean,
): string {
  return cross.oneOf
    ? crossListCondition(expr, cross.oneOf, kind, temporal)
    : crossCondition(expr, cross.value, kind, temporal);
}

function neutralFilterValue(operator: string, value: string, kind: DatabaseKind | null): string {
  if (kind !== "odbc" || !value.includes("\\")) return value;
  if (!operatorNeedsList(operator)) return neutralBackslashes(value, kind);
  return JSON.stringify(parseFilterList(value).map((item) => neutralBackslashes(item, kind)));
}

export function crossCondition(
  expr: string,
  value: unknown,
  kind: DatabaseKind | null,
  temporal = false,
): string {
  return value === null || value === undefined
    ? `${expr} IS NULL`
    : equalsLiteral(expr, crossLiteral(value, kind, temporal));
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
  scope: VariableScope = EMPTY_SCOPE,
  range: DateRange = periodRange(period),
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
  const plain = (m: DatasetMetric) => !summarizes(m, ds) && Boolean(m.column);
  const grouped =
    metrics.some((m) => summarizes(m, ds)) && (groups.length > 0 || metrics.some(plain));
  if (grouped) groups.push(...metrics.filter(plain).map((m) => aggExpr(m, ds, style)));
  const limit = Math.max(1, Math.floor(ds.limit || 50));
  const lines = [`SELECT ${kind === "mssql" ? `TOP ${limit} ` : ""}${select.join(", ")}`];
  const joins = datasetJoins(ds);
  const as = kind === "oracle" ? " " : " AS ";
  lines.push(`FROM ${table(ds.schema, ds.table)}${joins.length ? `${as}t1` : ""}`);
  for (const join of joins) {
    const parent = aliasOf(
      joins.find((j) => j.id === join.parent),
      joins,
    );
    const alias = aliasOf(join, joins);
    const pairs = [{ from: join.fromColumn, to: join.toColumn }, ...(join.extra ?? [])].filter(
      (pair) => pair.from && pair.to,
    );
    lines.push(
      `${join.kind === "inner" ? "INNER" : "LEFT"} JOIN ${table(join.schema, join.table)}${as}${alias} ON ${pairs.map((pair) => `${alias}.${q(pair.to)} = ${parent}.${q(pair.from)}`).join(" AND ")}`,
    );
  }
  const where = ds.filters
    .filter((f) => f.column)
    .map((f) => {
      const name = filterVariable(f.value);
      const value = name === null ? f.value : scopeValue(scope, name);
      if (value === null || (name !== null && !value.trim())) return null;
      return compileConditionExpression(
        refExpr(f.column, ds, style),
        f.operator,
        neutralFilterValue(f.operator, value, kind),
        kind,
        f.dataType,
      );
    })
    .filter((part): part is string => part !== null);
  for (const cross of ds[CROSS_WHERE] ?? [])
    where.push(
      compileCross(
        bucketExpr(refExpr(cross.ref, ds, style), cross.bucket, kind),
        cross,
        kind,
        cross.bucket !== "none",
      ),
    );
  if (ds.dateColumn) where.push(...rangeConditions(refExpr(ds.dateColumn, ds, style), range, kind));
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
  return substituteVariables(lines.join("\n"), scope, kind);
}

export function buildExpertSql(
  ds: Dataset,
  kind: DatabaseKind | null,
  period: Period,
  scope: VariableScope = EMPTY_SCOPE,
  range: DateRange = periodRange(period),
  top: number | null = null,
): string {
  const sql = substituteVariables(ds.sql.trim().replace(/;+\s*$/, ""), scope, kind);
  const style = identifierStyleForKind(kind);
  const conditions = (ds[CROSS_WHERE] ?? []).map((cross) =>
    compileCross(`q.${quoteIdentifier(cross.ref, style)}`, cross, kind, false),
  );
  if (ds.mapping.dateColumn && (range.start || range.end))
    conditions.push(
      ...rangeConditions(`q.${quoteIdentifier(ds.mapping.dateColumn, style)}`, range, kind),
    );
  return wrapExpert(sql, conditions, kind, top);
}

function wrapExpert(
  sql: string,
  conditions: string[],
  kind: DatabaseKind | null,
  top: number | null = null,
): string {
  if (!sql || (!conditions.length && top === null)) return sql;
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  if (kind === "mssql") {
    const parts = serverSqlParts(sql);
    const head = `SELECT ${top === null ? "" : `TOP ${top} `}*`;
    return parts.ctes
      ? `${parts.ctes},\nl8db_q AS (\n${parts.body}\n)\n${head} FROM l8db_q AS q${where}`
      : `${head} FROM (\n${parts.body}\n) AS q${where}`;
  }
  const as = kind === "oracle" ? "" : "AS ";
  const limit =
    top === null ? "" : kind === "oracle" ? ` FETCH FIRST ${top} ROWS ONLY` : ` LIMIT ${top}`;
  return `SELECT * FROM (\n${sql}\n) ${as}q${where}${limit}`;
}

export const DETAIL_LIMIT = 200;

export function datasetDetailSql(
  ds: Dataset,
  conditions: CrossCondition[],
  kind: DatabaseKind | null,
  period: Period,
  scope: VariableScope = EMPTY_SCOPE,
): string {
  if (ds.mode === "simple") {
    const simple: SimpleDataset = {
      ...ds.simple,
      dimension: null,
      dimension2: null,
      metrics: [],
      sort: "dimension",
      limit: DETAIL_LIMIT,
      [CROSS_WHERE]: [...(ds.simple[CROSS_WHERE] ?? []), ...conditions],
    };
    const sql = buildSimpleSql(simple, kind, period, scope);
    return datasetJoins(simple).length
      ? sql.replace(/^SELECT (TOP \d+ )?\*/, "SELECT $1t1.*")
      : sql;
  }
  return buildExpertSql(
    { ...ds, [CROSS_WHERE]: [...(ds[CROSS_WHERE] ?? []), ...conditions] },
    kind,
    period,
    scope,
    periodRange(period),
    DETAIL_LIMIT,
  );
}

export function datasetSql(
  ds: Dataset,
  kind: DatabaseKind | null,
  period: Period,
  scope: VariableScope = EMPTY_SCOPE,
  range: DateRange = periodRange(period),
): string {
  return ds.mode === "simple"
    ? buildSimpleSql(ds.simple, kind, period, scope, range)
    : buildExpertSql(ds, kind, period, scope, range);
}

const ADDITIVE: Agg[] = ["count", "sum"];

export function datasetMetricAggs(ds: Dataset): Agg[] {
  if (ds.mode === "expert") return ds.mapping.metrics.map(() => "sum");
  return ds.simple.metrics
    .filter((m) => m.agg === "count" || m.column)
    .map((m) => (aggregatedCalc(m, ds.simple) ? "avg" : m.agg));
}

export function needsTotals(ds: Dataset, rowCount: number): boolean {
  if (ds.mode !== "simple" || !ds.simple.dimension) return false;
  const aggs = datasetMetricAggs(ds);
  return (
    aggs.some(
      (agg) => agg !== "none" && !ADDITIVE.includes(agg) && agg !== "min" && agg !== "max",
    ) || rowCount >= Math.max(1, Math.floor(ds.simple.limit || 50))
  );
}

export function datasetTotalsSql(
  ds: Dataset,
  kind: DatabaseKind | null,
  period: Period,
  scope: VariableScope = EMPTY_SCOPE,
  range: DateRange = periodRange(period),
): string {
  if (ds.mode !== "simple") return "";
  return buildSimpleSql(
    { ...ds.simple, dimension: null, dimension2: null, sort: "dimension", limit: 1 },
    kind,
    period,
    scope,
    range,
  );
}

export const MAX_MARGIN_VALUES = 500;

export function datasetMarginSql(
  ds: Dataset,
  axis: "rows" | "columns",
  values: unknown[],
  kind: DatabaseKind | null,
  period: Period,
  scope: VariableScope = EMPTY_SCOPE,
  range: DateRange = periodRange(period),
): string {
  if (ds.mode !== "simple" || !ds.simple.dimension || !ds.simple.dimension2) return "";
  if (!values.length || values.length > MAX_MARGIN_VALUES) return "";
  const dimension =
    axis === "rows"
      ? ds.simple.dimension
      : { column: ds.simple.dimension2, bucket: "none" as const };
  const visible: CrossCondition = {
    ref: dimension.column,
    bucket: dimension.bucket,
    oneOf: values,
  };
  return buildSimpleSql(
    {
      ...ds.simple,
      dimension,
      dimension2: null,
      sort: "dimension",
      limit: values.length,
      [CROSS_WHERE]: [...(ds.simple[CROSS_WHERE] ?? []), visible],
    },
    kind,
    period,
    scope,
    range,
  );
}

export type TrendBucket = "day" | "week" | "month";

export function trendBucket(period: Period): TrendBucket {
  if (period === "7d" || period === "30d") return "day";
  return period === "90d" || period === "quarter" ? "week" : "month";
}

export function currentBucketStart(bucket: TrendBucket, now = new Date()): string {
  if (bucket === "month") return isoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  return isoDate(bucket === "week" ? addDays(now, -((now.getDay() + 6) % 7)) : now);
}

const TREND_LIMIT = 400;

export function datasetTrendSql(
  ds: Dataset,
  kind: DatabaseKind | null,
  period: Period,
  scope: VariableScope = EMPTY_SCOPE,
  range: DateRange = periodRange(period),
): string {
  const bucket = trendBucket(period);
  if (ds.mode === "simple") {
    const s = ds.simple;
    if (!s.dateColumn) return "";
    return buildSimpleSql(
      {
        ...s,
        dimension: { column: s.dateColumn, bucket },
        dimension2: null,
        sort: "dimension",
        limit: TREND_LIMIT,
      },
      kind,
      period,
      scope,
      range,
    );
  }
  const date = ds.mapping.dateColumn;
  const base = buildExpertSql(ds, kind, period, scope, range);
  if (!base || !date || !ds.mapping.metrics.length) return "";
  const style = identifierStyleForKind(kind);
  const q = (name: string) => quoteIdentifier(name, style);
  const dim = bucketExpr(`t.${q(date)}`, bucket, kind);
  const metrics = ds.mapping.metrics.map((m) => `SUM(t.${q(m)}) AS ${q(m)}`);
  const select = `SELECT ${dim} AS ${q(DIM_KEY)}, ${metrics.join(", ")}`;
  if (kind === "mssql") {
    const parts = serverSqlParts(base);
    const head = parts.ctes ? `${parts.ctes},\n` : "WITH ";
    return `${head}l8db_t AS (\n${parts.body}\n)\n${select} FROM l8db_t AS t GROUP BY ${dim} ORDER BY 1`;
  }
  return `${select} FROM (\n${base}\n) ${kind === "oracle" ? "" : "AS "}t GROUP BY ${dim} ORDER BY 1`;
}
