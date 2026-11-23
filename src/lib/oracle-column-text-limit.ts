import type { DatabaseKind, DetailedColumnInfo } from "@/lib/db";

export function oracleColumnTextLimit(column: DetailedColumnInfo, kind?: DatabaseKind) {
  const limit = column.oracle_text_limit;
  if (kind !== "oracle" || !limit || !Number.isSafeInteger(limit.length) || limit.length <= 0) {
    return undefined;
  }
  const supportedType =
    limit.unit === "BYTE"
      ? /^(?:char|varchar2)(?:\(\d+\))?$/i
      : /^(?:n?char|n?varchar2)(?:\(\d+\))?$/i;
  return (limit.unit === "BYTE" || limit.unit === "CHAR") && supportedType.test(column.data_type)
    ? limit
    : undefined;
}
