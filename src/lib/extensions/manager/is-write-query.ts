export const SECRET_KEY_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

export function isWriteQuery(sql: string): boolean {
  const cleaned = sql
    .replace(/--[^\n]*(\n|$)/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .trimStart();
  if (/;[\s\S]*\S/.test(cleaned)) return true;
  const first = cleaned.match(/^\(?\s*([a-zA-Z]+)/)?.[1].toUpperCase() ?? "";
  return !["SELECT", "WITH", "EXPLAIN", "SHOW", "DESCRIBE", "DESC", "VALUES", "TABLE"].includes(
    first,
  );
}
