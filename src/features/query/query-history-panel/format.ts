let timeFormatter: Intl.DateTimeFormat | undefined;

export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  timeFormatter ??= new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  return timeFormatter.format(date);
}

export function firstLine(sql: string): string {
  const start = sql.search(/\S/);
  if (start < 0) return "";
  const end = sql.indexOf("\n", start);
  const line = sql.slice(start, end < 0 ? undefined : end).trimEnd();
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}
