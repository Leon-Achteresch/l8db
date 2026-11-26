import { sqlPreviewLine } from "@/lib/sql-preview-line";

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
  return sqlPreviewLine(sql, 80);
}
