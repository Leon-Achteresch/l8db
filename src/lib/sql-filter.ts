export interface OperatorDef {
  key: string;
  label: string;
  needsValue: boolean;
}

export const OPERATORS: OperatorDef[] = [
  { key: "eq", label: "ist gleich", needsValue: true },
  { key: "neq", label: "ist ungleich", needsValue: true },
  { key: "gt", label: "ist größer als", needsValue: true },
  { key: "gte", label: "ist größer/gleich", needsValue: true },
  { key: "lt", label: "ist kleiner als", needsValue: true },
  { key: "lte", label: "ist kleiner/gleich", needsValue: true },
  { key: "contains", label: "enthält", needsValue: true },
  { key: "startsWith", label: "beginnt mit", needsValue: true },
  { key: "endsWith", label: "endet mit", needsValue: true },
  { key: "isNull", label: "ist leer", needsValue: false },
  { key: "isNotNull", label: "ist nicht leer", needsValue: false },
];

export function operatorNeedsValue(key: string): boolean {
  return OPERATORS.find((op) => op.key === key)?.needsValue ?? true;
}

export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export function quoteLiteral(value: string): string {
  const trimmed = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
  if (trimmed === "true" || trimmed === "false" || trimmed === "null") return trimmed;
  return `'${value.replace(/'/g, "''")}'`;
}

export function quoteLike(value: string): string {
  return value.replace(/'/g, "''").replace(/([%_\\])/g, "\\$1");
}

export function compileSingleCondition(
  column: string,
  operator: string,
  value: string,
): string | null {
  if (!column) return null;
  if (operatorNeedsValue(operator) && value === "") return null;
  const col = quoteIdent(column);
  switch (operator) {
    case "eq":
      return `${col} = ${quoteLiteral(value)}`;
    case "neq":
      return `${col} <> ${quoteLiteral(value)}`;
    case "gt":
      return `${col} > ${quoteLiteral(value)}`;
    case "gte":
      return `${col} >= ${quoteLiteral(value)}`;
    case "lt":
      return `${col} < ${quoteLiteral(value)}`;
    case "lte":
      return `${col} <= ${quoteLiteral(value)}`;
    case "contains":
      return `${col}::text ILIKE '%${quoteLike(value)}%'`;
    case "startsWith":
      return `${col}::text ILIKE '${quoteLike(value)}%'`;
    case "endsWith":
      return `${col}::text ILIKE '%${quoteLike(value)}'`;
    case "isNull":
      return `${col} IS NULL`;
    case "isNotNull":
      return `${col} IS NOT NULL`;
    default:
      return null;
  }
}
