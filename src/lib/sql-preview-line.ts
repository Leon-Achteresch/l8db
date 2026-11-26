const moreTextOnLine = /[^\S\n]*\S/y;

export function sqlPreviewLine(sql: string, limit: number, suffix = "…"): string {
  const start = sql.search(/\S/);
  if (start < 0) return "";

  const prefix = sql.slice(start, start + limit);
  const newline = prefix.indexOf("\n");
  if (newline >= 0) return prefix.slice(0, newline).trimEnd();
  if (start + prefix.length === sql.length) return prefix.trimEnd();

  moreTextOnLine.lastIndex = start + limit;
  return moreTextOnLine.test(sql) ? prefix + suffix : prefix.trimEnd();
}
