export type QueryParam = string | number | boolean | null;

const TEXT_BOOLEAN_KINDS = new Set(["postgres", "duckdb"]);

export function bindQueryParams(params: QueryParam[], kind: string): (string | null)[] {
  return params.map((value) => {
    if (value === null || typeof value === "string") return value;
    if (typeof value === "boolean") {
      if (TEXT_BOOLEAN_KINDS.has(kind)) return value ? "true" : "false";
      return value ? "1" : "0";
    }
    return String(value);
  });
}
