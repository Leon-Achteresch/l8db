import { compileConditionExpression } from "./compile";
import { compileMongoCondition } from "./mongo";
import { combineFilterConditions, type FilterKind, operatorNeedsValue } from "./operators";
import { quoteIdent } from "./quote";

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
  return compileConditionExpression(
    quoteIdent(column, kind),
    operator,
    value,
    kind,
    dataType,
    true,
  );
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
