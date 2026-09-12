import type { DatabaseKind } from "@/lib/db";
import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";
import { compileConditionExpression, type FilterKind } from "@/lib/sql-filter";

export type QuerySource = "base" | "join";
export type JoinType = "INNER" | "LEFT";
export type SortDirection = "ASC" | "DESC";

export const BASE_ALIAS = "t1";
export const JOIN_ALIAS = "t2";

export interface BuilderCondition {
  id: string;
  source: QuerySource;
  column: string;
  operator: string;
  value: string;
  dataType?: string;
}

export interface BuilderOrder {
  id: string;
  source: QuerySource;
  column: string;
  direction: SortDirection;
}

export interface BuilderJoin {
  constraintName: string;
  type: JoinType;
  schema: string;
  table: string;
  fromColumn: string;
  toColumn: string;
  columns: string[];
}

export interface QueryBuilderState {
  kind: DatabaseKind | null;
  schema: string;
  table: string;
  columns: string[];
  join: BuilderJoin | null;
  conditions: BuilderCondition[];
  orders: BuilderOrder[];
  limit: number | null;
}

export function emptyBuilderState(kind: DatabaseKind | null): QueryBuilderState {
  return {
    kind,
    schema: "",
    table: "",
    columns: [],
    join: null,
    conditions: [],
    orders: [],
    limit: 100,
  };
}

export function joinKey(join: {
  constraintName: string;
  schema: string;
  table: string;
  fromColumn: string;
  toColumn: string;
}): string {
  return [join.constraintName, join.schema, join.table, join.fromColumn, join.toColumn].join("|");
}

export function joinLabel(join: {
  constraintName: string;
  schema: string;
  table: string;
  fromColumn: string;
  toColumn: string;
}): string {
  return `${join.constraintName}: ${join.fromColumn} → ${join.schema}.${join.table}.${join.toColumn}`;
}

function aliasFor(source: QuerySource): string {
  return source === "join" ? JOIN_ALIAS : BASE_ALIAS;
}

function columnExpr(
  state: QueryBuilderState,
  source: QuerySource,
  column: string,
  style: ReturnType<typeof identifierStyleForKind>,
): string {
  const quoted = quoteIdentifier(column, style);
  if (!state.join) return quoted;
  return `${aliasFor(source)}.${quoted}`;
}

export function compileBuilderCondition(
  columnExpression: string,
  operator: string,
  value: string,
  kind?: FilterKind,
  dataType?: string,
) {
  return compileConditionExpression(columnExpression, operator, value, kind, dataType);
}

function qualifiedTable(
  schema: string,
  table: string,
  style: ReturnType<typeof identifierStyleForKind>,
) {
  const name = quoteIdentifier(table, style);
  return schema ? `${quoteIdentifier(schema, style)}.${name}` : name;
}

export function isBuilderReady(state: QueryBuilderState): boolean {
  return state.table.trim() !== "";
}

export function buildSelectSql(state: QueryBuilderState): string {
  if (!isBuilderReady(state)) return "";
  const style = identifierStyleForKind(state.kind);
  const join = state.join;
  const selectParts: string[] = [];

  for (const column of state.columns) {
    selectParts.push(columnExpr(state, "base", column, style));
  }
  if (join) {
    for (const column of join.columns) {
      const expr = columnExpr(state, "join", column, style);
      const alias = quoteIdentifier(`${join.table}_${column}`, style);
      selectParts.push(`${expr} AS ${alias}`);
    }
  }
  if (selectParts.length === 0) {
    selectParts.push(join ? `${BASE_ALIAS}.*` : "*");
  }

  const lines: string[] = [];
  lines.push(`SELECT ${selectParts.join(", ")}`);
  const from = qualifiedTable(state.schema, state.table, style);
  lines.push(join ? `FROM ${from} AS ${BASE_ALIAS}` : `FROM ${from}`);

  if (join) {
    const target = qualifiedTable(join.schema, join.table, style);
    const left = `${JOIN_ALIAS}.${quoteIdentifier(join.toColumn, style)}`;
    const right = `${BASE_ALIAS}.${quoteIdentifier(join.fromColumn, style)}`;
    lines.push(`${join.type} JOIN ${target} AS ${JOIN_ALIAS} ON ${left} = ${right}`);
  }

  const whereParts = state.conditions
    .filter((condition) => condition.column.trim() !== "")
    .filter((condition) => condition.source !== "join" || join !== null)
    .map((condition) =>
      compileBuilderCondition(
        columnExpr(state, condition.source, condition.column, style),
        condition.operator,
        condition.value,
        state.kind,
        condition.dataType,
      ),
    )
    .filter((part): part is string => part !== null);
  if (whereParts.length > 0) {
    lines.push(`WHERE ${whereParts.join(" AND ")}`);
  }

  const orderParts = state.orders
    .filter((order) => order.column.trim() !== "")
    .filter((order) => order.source !== "join" || join !== null)
    .map((order) => `${columnExpr(state, order.source, order.column, style)} ${order.direction}`);
  if (orderParts.length > 0) {
    lines.push(`ORDER BY ${orderParts.join(", ")}`);
  }

  if (state.limit !== null && Number.isFinite(state.limit) && state.limit > 0) {
    lines.push(`LIMIT ${Math.floor(state.limit)}`);
  }

  return `${lines.join("\n")};`;
}

export interface ColumnOption {
  dataType?: string;
  value: string;
  label: string;
  source: QuerySource;
  column: string;
}

export function columnOptionValue(source: QuerySource, column: string): string {
  return `${source}:${column}`;
}

export function parseColumnOptionValue(value: string): { source: QuerySource; column: string } {
  const separator = value.indexOf(":");
  const source = value.slice(0, separator) === "join" ? "join" : "base";
  return { source, column: value.slice(separator + 1) };
}

export function buildViewDdl(
  kind: DatabaseKind | null | undefined,
  schema: string,
  view: string,
  body: string,
): string {
  const style = identifierStyleForKind(kind);
  const target = schema
    ? `${quoteIdentifier(schema, style)}.${quoteIdentifier(view, style)}`
    : quoteIdentifier(view, style);
  const select = body.trim().replace(/;+\s*$/, "");
  if (kind === "mssql") return `CREATE OR ALTER VIEW ${target} AS\n${select};`;
  if (kind === "sqlite")
    return `DROP VIEW IF EXISTS ${target};\nCREATE VIEW ${target} AS\n${select};`;
  return `CREATE OR REPLACE VIEW ${target} AS\n${select};`;
}
