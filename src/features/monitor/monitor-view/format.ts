import type { SessionInfo } from "@/lib/db";

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

export function formatElapsed(value: string | null): string {
  if (!value) return "—";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "—";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
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

export function sessionPriority(session: SessionInfo): number {
  if (session.blocked_by.length > 0) return 0;
  if (session.state === "active") return 1;
  if (session.wait_event) return 2;
  return 3;
}

export function sessionStateVariant(
  session: SessionInfo,
): "default" | "secondary" | "destructive" | "outline" {
  if (session.blocked_by.length > 0) return "destructive";
  if (session.state === "active") return "default";
  if (session.wait_event) return "secondary";
  return "outline";
}
