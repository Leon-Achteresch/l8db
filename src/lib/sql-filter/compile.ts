import {
  type FilterKind,
  filterOperatorsForKind,
  operatorNeedsValue,
  parseFilterList,
} from "./operators";
import { literalIsText, quoteLike, quoteLiteral, quoteString, textMatch } from "./quote";

function nextDay(value: string, kind?: FilterKind, dataType?: string): string | null {
  const day = value.trim();
  const type = dataType?.toLowerCase().trim() ?? "";
  if (!/timestamp|datetime/.test(type) && !(kind === "oracle" && type === "date")) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const time = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== day) return null;
  return new Date(time + 86_400_000).toISOString().slice(0, 10);
}

export function compileConditionExpression(
  columnExpression: string,
  operator: string,
  value: string,
  kind?: FilterKind,
  dataType?: string,
  insensitive = false,
): string | null {
  if (kind === "mongodb" || kind === "redis") return null;
  if (!filterOperatorsForKind(kind).some((op) => op.key === operator)) return null;
  if (operatorNeedsValue(operator) && value.trim() === "") return null;
  if (kind === "dynamodb" && (operator === "contains" || operator === "startsWith"))
    return `${operator === "contains" ? "contains" : "begins_with"}(${columnExpression}, ${quoteString(value, kind)})`;
  const end = ["eq", "neq", "gt", "lte"].includes(operator) ? nextDay(value, kind, dataType) : null;
  if (end) {
    const start = quoteLiteral(value.trim(), kind, dataType);
    const before = `${columnExpression} < ${quoteLiteral(end, kind, dataType)}`;
    const after = `${columnExpression} >= ${quoteLiteral(end, kind, dataType)}`;
    if (operator === "gt") return after;
    if (operator === "lte") return before;
    if (operator === "neq") return `(${columnExpression} < ${start} OR ${after})`;
    const range = `${columnExpression} >= ${start} AND ${before}`;
    return kind === "cassandra" ? range : `(${range})`;
  }
  const insensitiveMatch = (item: string) =>
    insensitive && literalIsText(item, kind, dataType)
      ? textMatch(columnExpression, quoteLike(item, kind), kind)
      : "";
  switch (operator) {
    case "in":
    case "notIn": {
      const values = parseFilterList(value);
      if (values.length === 0) return null;
      const matches = values.map(insensitiveMatch);
      if (matches.every(Boolean)) {
        const joined = matches.length === 1 ? matches[0] : `(${matches.join(" OR ")})`;
        return operator === "in" ? joined : `NOT (${joined})`;
      }
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
      return (
        insensitiveMatch(value) || `${columnExpression} = ${quoteLiteral(value, kind, dataType)}`
      );
    case "neq": {
      const match = insensitiveMatch(value);
      return match
        ? `NOT (${match})`
        : `${columnExpression} <> ${quoteLiteral(value, kind, dataType)}`;
    }
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
