import { operatorNeedsList, parseFilterList } from "./operators";

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

export function compileMongoCondition(
  column: string,
  operator: string,
  value: string,
  dataType?: string,
): string | null {
  const literal = mongoValue(value, dataType);
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if ((operator === "eq" || operator === "neq") && typeof literal === "string" && value.trim()) {
    const regex = { $regex: `^${escaped}$`, $options: "i" };
    return JSON.stringify({ [column]: operator === "eq" ? regex : { $not: regex } });
  }
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
    return JSON.stringify({
      [column]: {
        $regex: `${operator === "startsWith" ? "^" : ""}${escaped}${operator === "endsWith" ? "$" : ""}`,
        $options: "i",
      },
    });
  }
  return null;
}
