export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toLocaleString("de-DE", { maximumFractionDigits: 1 })} ${units[index]}`;
}

export function formatMs(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("de-DE", { maximumFractionDigits: 0 })} ms`;
}

export function formatTime(value: number | string | null): string {
  if (value == null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleTimeString("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDateTime(value: number | string | null): string {
  if (value == null) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("de-DE", {
    dateStyle: "short",
    timeStyle: "medium",
  });
}

export function firstLine(sql: string): string {
  const line =
    sql
      .split("\n")
      .map((part) => part.trim())
      .filter(Boolean)[0] ?? "";
  return line.length > 110 ? `${line.slice(0, 110)}…` : line;
}

export function levelVariant(level: string): "destructive" | "secondary" | "outline" {
  const upper = level.toUpperCase();
  if (upper.includes("ERROR") || upper.includes("FEHLER")) return "destructive";
  if (upper.includes("WARN")) return "secondary";
  return "outline";
}

export function formatSeconds(totalSeconds: number | null): string {
  if (totalSeconds == null || !Number.isFinite(totalSeconds)) return "—";
  const seconds = Math.max(0, Math.floor(totalSeconds));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${String(seconds % 60).padStart(2, "0")} s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ${String(minutes % 60).padStart(2, "0")} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

export function secondsSince(value: string | null | undefined, now: number): number | null {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (now - timestamp) / 1000);
}

export function formatCount(value: number | null, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("de-DE", { maximumFractionDigits: digits });
}

export function formatPercent(value: number | null, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("de-DE", { maximumFractionDigits: digits })} %`;
}
