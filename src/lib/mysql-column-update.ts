import type { DatabaseKind, DetailedColumnInfo } from "@/lib/db";

export function mysqlColumnOnUpdate(column: DetailedColumnInfo, kind?: DatabaseKind) {
  const expression = column.on_update;
  return kind === "mysql" &&
    /^(?:timestamp|datetime)(?:\([0-6]\))?$/i.test(column.data_type) &&
    typeof expression === "string" &&
    /^CURRENT_TIMESTAMP(?:\([0-6]\))?$/.test(expression)
    ? expression
    : undefined;
}
