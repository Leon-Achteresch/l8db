export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function firstLine(sql: string): string {
  const line =
    sql
      .split("\n")
      .map((part) => part.trim())
      .filter(Boolean)[0] ?? "";
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}
