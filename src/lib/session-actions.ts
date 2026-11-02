import type { DatabaseKind } from "@/lib/db";

export type SessionAction = "cancel" | "terminate";

export function sessionIdLabel(kind: DatabaseKind | undefined): string {
  return kind === "oracle" ? "SID" : "PID";
}

export function sessionActionMessage(
  action: SessionAction,
  done: boolean,
  kind: DatabaseKind | undefined,
  pid: number,
): string {
  const id = `${sessionIdLabel(kind)} ${pid}`;
  if (action === "cancel")
    return done ? `Abfrage auf ${id} abgebrochen.` : `${id}: nichts abzubrechen.`;
  return done ? `Sitzung ${id} beendet.` : `Sitzung ${id} war bereits beendet.`;
}
