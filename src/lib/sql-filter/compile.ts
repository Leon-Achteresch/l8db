import {
  type FilterKind,
  filterOperatorsForKind,
  operatorNeedsValue,
  parseFilterList,
} from "./operators";
import { literalIsText, quoteLike, quoteLiteral, quoteString, textMatch } from "./quote";

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
