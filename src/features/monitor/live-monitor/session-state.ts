import type { SessionInfo } from "@/lib/db";

export function sessionDotClass(session: SessionInfo): string {
  if (session.blocked_by.length > 0) return "bg-destructive";
  const state = session.state ?? "";
  if (state === "active") return "bg-emerald-500";
  if (state.startsWith("idle in transaction")) return "bg-amber-500";
  return "bg-muted-foreground/50";
}

export function sessionStateLabel(session: SessionInfo): string {
  if (session.blocked_by.length > 0) return "blockiert";
  if (session.state === "active") return "running";
  return session.state || "—";
}

export function clientAddress(session: SessionInfo): string {
  if (!session.client_addr) return session.backend_type === "client backend" ? "lokal" : "—";
  return session.client_port
    ? `${session.client_addr}:${session.client_port}`
    : session.client_addr;
}

export function shortQuery(sql: string, length = 60): string {
  const line = sql.replace(/\s+/g, " ").trim();
  return line.length > length ? `${line.slice(0, length)}…` : line;
}
