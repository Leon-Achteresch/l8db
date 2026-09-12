import type { DatabaseKind } from "@/lib/db";
import { identifierStyleForKind, quoteIdentifier } from "@/lib/export";

export type FilterOperatorKey =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "in"
  | "notIn"
  | "contains"
  | "startsWith"
  | "endsWith"
  | "isNull"
  | "isNotNull";

export interface OperatorDef {
  key: FilterOperatorKey;
  label: string;
  needsValue: boolean;
  sqlLabel: string;
}

export const OPERATORS: OperatorDef[] = [
  { key: "eq", sqlLabel: "=", label: "ist gleich", needsValue: true },
  { key: "neq", sqlLabel: "<>", label: "ist ungleich", needsValue: true },
  { key: "in", sqlLabel: "IN", label: "ist in Liste", needsValue: true },
  { key: "notIn", sqlLabel: "NOT IN", label: "ist nicht in Liste", needsValue: true },
  { key: "gt", sqlLabel: ">", label: "ist größer als", needsValue: true },
  { key: "gte", sqlLabel: ">=", label: "ist größer/gleich", needsValue: true },
  { key: "lt", sqlLabel: "<", label: "ist kleiner als", needsValue: true },
  { key: "lte", sqlLabel: "<=", label: "ist kleiner/gleich", needsValue: true },
  { key: "contains", sqlLabel: "LIKE '%…%'", label: "enthält", needsValue: true },
  { key: "startsWith", sqlLabel: "LIKE '…%'", label: "beginnt mit", needsValue: true },
  { key: "endsWith", sqlLabel: "LIKE '%…'", label: "endet mit", needsValue: true },
  { key: "isNull", sqlLabel: "IS NULL", label: "ist NULL", needsValue: false },
  { key: "isNotNull", sqlLabel: "IS NOT NULL", label: "ist nicht NULL", needsValue: false },
];

export type FilterKind = DatabaseKind | null | undefined;

export function filterOperatorsForKind(kind?: FilterKind): OperatorDef[] {
  if (kind === "cassandra") {
    return OPERATORS.filter((op) => ["eq", "gt", "gte", "lt", "lte", "in"].includes(op.key));
  }
  if (kind === "redis") {
    return OPERATORS.filter((op) => ["eq", "contains", "startsWith", "endsWith"].includes(op.key));
  }
  return OPERATORS;
}

export function filterOperatorLabel(key: string, translated = true, kind?: FilterKind): string {
  const operator = OPERATORS.find((op) => op.key === key);
  if (!operator) return key;
  if (translated) return operator.label;
  if (kind === "redis") {
    return (
      { eq: "MATCH …", contains: "MATCH *…*", startsWith: "MATCH …*", endsWith: "MATCH *…" }[key] ??
      key
    );
  }
  if (kind === "mongodb") {
    return (
      {
        eq: "$eq",
        neq: "$ne",
        gt: "$gt",
        gte: "$gte",
        lt: "$lt",
        lte: "$lte",
        in: "$in",
        notIn: "$nin",
        contains: "$regex …",
        startsWith: "$regex ^…",
        endsWith: "$regex …$",
        isNull: "$type: null",
        isNotNull: "$exists + $ne: null",
      }[key] ?? key
    );
  }
  const insensitive = !kind || ["postgres", "duckdb", "clickhouse"].includes(kind);
  return insensitive ? operator.sqlLabel.replace("LIKE", "ILIKE") : operator.sqlLabel;
}

export function filterSupportsOr(kind?: FilterKind): boolean {
  return kind !== "cassandra" && kind !== "redis";
}

export function combineFilterConditions(
  parts: string[],
  combinator: "AND" | "OR",
  kind?: FilterKind,
): string {
  if (!parts.length) return "";
  if (kind === "mongodb") {
    return parts.length === 1
      ? parts[0]
      : JSON.stringify({
          [combinator === "OR" ? "$or" : "$and"]: parts.map((part) => JSON.parse(part)),
        });
  }
  return parts.join(` ${filterSupportsOr(kind) ? combinator : "AND"} `);
}

export function operatorNeedsList(key: string): boolean {
  return key === "in" || key === "notIn";
}

export function parseFilterList(value: string): string[] {
  if (!value.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) {
      return [...new Set(parsed.filter((item) => item.trim() !== ""))];
    }
  } catch {
    return [value];
  }
  return [value];
}

export function changeFilterOperator(value: string, previous: string, next: string): string {
  if (operatorNeedsList(previous) === operatorNeedsList(next)) return value;
  return operatorNeedsList(next)
    ? JSON.stringify(value.trim() ? [value] : [])
    : (parseFilterList(value)[0] ?? "");
}

export function operatorNeedsValue(key: string): boolean {
  return OPERATORS.find((op) => op.key === key)?.needsValue ?? true;
}

export function quoteIdent(name: string, kind?: FilterKind): string {
  return quoteIdentifier(
    kind === "clickhouse" ? name.replace(/\\/g, "\\\\") : name,
    identifierStyleForKind(kind),
  );
}

export function quoteLiteral(value: string, kind?: FilterKind, dataType?: string): string {
  const trimmed = value.trim();
  const type = (dataType?.toLowerCase() ?? "").replace(
    /^(?:nullable|lowcardinality)\((.*)\)$/,
    "$1",
  );
  if (
    kind === "cassandra" &&
    /^(time)?uuid$/.test(type) &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(trimmed)
  )
    return trimmed;
  if (
    type &&
    !/^(?:tinyint|smallint|mediumint|bigint|int(?:eger|\d+)?|uint\d+|float\d*|double(?: precision)?|decimal|numeric|number|real|money|smallmoney|bool(?:ean)?|bit)(?:\b|\()/.test(
      type,
    )
  )
    return quoteString(value, kind);
  if (kind === "mssql" && type === "bit" && /^(true|false)$/i.test(trimmed))
    return trimmed.toLowerCase() === "true" ? "1" : "0";
  const strict = kind === "oracle" || kind === "mssql";
  if (!strict && /^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (!strict && (trimmed === "true" || trimmed === "false")) return trimmed;
  return quoteString(value, kind);
}

export function quoteString(value: string, kind?: FilterKind): string {
  if (kind === "mysql" && value.includes("\\")) {
    return `CONCAT(${value
      .split("\\")
      .map((part) => quoteString(part, kind))
      .join(", CHAR(92 USING utf8mb4), ")})`;
  }
  const postgresEscape = (!kind || kind === "postgres") && value.includes("\\");
  const escaped = kind === "clickhouse" || postgresEscape ? value.replace(/\\/g, "\\\\") : value;
  return `${kind === "mssql" ? "N" : postgresEscape ? "E" : ""}'${escaped.replace(/'/g, "''")}'`;
}

export function quoteLike(value: string, kind?: FilterKind): string {
  const escapeCharacter = kind === "clickhouse" ? "\\" : "!";
  const special = kind === "clickhouse" ? /[%_\\]/g : kind === "mssql" ? /[!%_[]/g : /[!%_]/g;
  return value.replace(special, (character) => `${escapeCharacter}${character}`);
}

export function textMatch(columnExpression: string, pattern: string, kind?: FilterKind): string {
  const literal = quoteString(pattern, kind);
  switch (kind) {
    case "oracle":
      return `UPPER(TO_CHAR(${columnExpression})) LIKE UPPER(${literal}) ESCAPE '!'`;
    case "mssql":
      return `CAST(${columnExpression} AS NVARCHAR(MAX)) LIKE ${literal} ESCAPE '!'`;
    case "mysql":
      return `CAST(${columnExpression} AS CHAR) LIKE ${literal} ESCAPE '!'`;
    case "sqlite":
      return `CAST(${columnExpression} AS TEXT) LIKE ${literal} ESCAPE '!'`;
    case "clickhouse":
      return `toString(${columnExpression}) ILIKE ${literal}`;
    case "odbc":
      return `UPPER(CAST(${columnExpression} AS VARCHAR(4000))) LIKE UPPER(${literal}) ESCAPE '!'`;
    case "duckdb":
      return `CAST(${columnExpression} AS VARCHAR) ILIKE ${literal} ESCAPE '!'`;
    case "cassandra":
    case "mongodb":
    case "redis":
      return "";
    default:
      return `${columnExpression}::text ILIKE ${literal} ESCAPE '!'`;
  }
}

export function compileConditionExpression(
  columnExpression: string,
  operator: string,
  value: string,
  kind?: FilterKind,
  dataType?: string,
): string | null {
  if (kind === "mongodb" || kind === "redis") return null;
  if (!filterOperatorsForKind(kind).some((op) => op.key === operator)) return null;
  if (operatorNeedsValue(operator) && value.trim() === "") return null;
  switch (operator) {
    case "in":
    case "notIn": {
      const values = parseFilterList(value);
      if (values.length === 0) return null;
      const sqlOperator = operator === "in" ? "IN" : "NOT IN";
      const clauses: string[] = [];
      const chunkSize = kind === "oracle" ? 1000 : values.length;
      for (let offset = 0; offset < values.length; offset += chunkSize) {
        const literals = values
          .slice(offset, offset + chunkSize)
          .map((item) => quoteLiteral(item, kind, dataType));
        clauses.push(`${columnExpression} ${sqlOperator} (${literals.join(", ")})`);
      }
      return clauses.length === 1
        ? clauses[0]
        : `(${clauses.join(operator === "in" ? " OR " : " AND ")})`;
    }
    case "eq":
      return `${columnExpression} = ${quoteLiteral(value, kind, dataType)}`;
    case "neq":
      return `${columnExpression} <> ${quoteLiteral(value, kind, dataType)}`;
    case "gt":
      return `${columnExpression} > ${quoteLiteral(value, kind, dataType)}`;
    case "gte":
      return `${columnExpression} >= ${quoteLiteral(value, kind, dataType)}`;
    case "lt":
      return `${columnExpression} < ${quoteLiteral(value, kind, dataType)}`;
    case "lte":
      return `${columnExpression} <= ${quoteLiteral(value, kind, dataType)}`;
    case "contains":
      return textMatch(columnExpression, `%${quoteLike(value, kind)}%`, kind);
    case "startsWith":
      return textMatch(columnExpression, `${quoteLike(value, kind)}%`, kind);
    case "endsWith":
      return textMatch(columnExpression, `%${quoteLike(value, kind)}`, kind);
    case "isNull":
      return `${columnExpression} IS NULL`;
    case "isNotNull":
      return `${columnExpression} IS NOT NULL`;
    default:
      return null;
  }
}

function mongoValue(value: string, dataType?: string): string | number | boolean {
  if (dataType && /string|text|char/i.test(dataType)) return value;
  if (value === "true" || value === "false") return value === "true";
  if (
    /^-?\d+(\.\d+)?$/.test(value) &&
    Number.isFinite(Number(value)) &&
    (!Number.isInteger(Number(value)) || Number.isSafeInteger(Number(value)))
  )
    return Number(value);
  return value;
}

function compileMongoCondition(
  column: string,
  operator: string,
  value: string,
  dataType?: string,
): string | null {
  const literal = mongoValue(value, dataType);
  const comparison = { eq: "$eq", neq: "$ne", gt: "$gt", gte: "$gte", lt: "$lt", lte: "$lte" }[
    operator
  ];
  if (comparison)
    return value.trim() ? JSON.stringify({ [column]: { [comparison]: literal } }) : null;
  if (operatorNeedsList(operator)) {
    const values = parseFilterList(value).map((item) => mongoValue(item, dataType));
    return values.length
      ? JSON.stringify({ [column]: { [operator === "in" ? "$in" : "$nin"]: values } })
      : null;
  }
  if (operator === "isNull") return JSON.stringify({ [column]: { $type: 10 } });
  if (operator === "isNotNull") return JSON.stringify({ [column]: { $exists: true, $ne: null } });
  if (["contains", "startsWith", "endsWith"].includes(operator) && value.trim()) {
    const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return JSON.stringify({
      [column]: {
        $regex: `${operator === "startsWith" ? "^" : ""}${escaped}${operator === "endsWith" ? "$" : ""}`,
        $options: "i",
      },
    });
  }
  return null;
}

export function compileSingleCondition(
  column: string,
  operator: string,
  value: string,
  kind?: FilterKind,
  dataType?: string,
): string | null {
  if (!column) return null;
  if (operatorNeedsValue(operator) && value === "") return null;
  if (kind === "mongodb") return compileMongoCondition(column, operator, value, dataType);
  return compileConditionExpression(quoteIdent(column, kind), operator, value, kind, dataType);
}

export function compileFilterConditions(
  conditions: { column: string; operator: string; value: string; dataType?: string }[],
  combinator: "AND" | "OR",
  kind?: FilterKind,
  columnDetails?: { name: string; data_type: string }[],
): string {
  return combineFilterConditions(
    conditions
      .map((condition) =>
        compileSingleCondition(
          condition.column,
          condition.operator,
          condition.value,
          kind,
          columnDetails?.find((column) => column.name === condition.column)?.data_type ??
            condition.dataType,
        ),
      )
      .filter((part): part is string => part !== null),
    combinator,
    kind,
  );
}

export function compileContentFilter(columns: string[], value: string, kind?: FilterKind): string {
  return combineFilterConditions(
    [...new Set(columns)]
      .map((col) => compileSingleCondition(col, "contains", value, kind))
      .filter((part): part is string => part !== null),
    "OR",
    kind,
  );
}
