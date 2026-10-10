import type { SavedConnection } from "@/lib/connections";
import { isProduction, isProductionLocked, PRODUCTION_LOCK_MESSAGE } from "@/lib/environments";
import { writesData } from "@/lib/sql-safety";
import type { MultiTarget } from "./run";

export interface GatedTarget {
  target: MultiTarget;
  connection: SavedConnection | null;
}

export interface MultiTargetGate {
  write: boolean;
  allowed: MultiTarget[];
  rejected: { target: MultiTarget; reason: string }[];
  production: MultiTarget[];
  readOnly: MultiTarget[];
  requiresConfirmation: boolean;
  requiresProductionConfirmation: boolean;
}

export const READ_ONLY_TARGET_REASON =
  "Schreibgeschützte Verbindung: Schreibende Anweisungen werden für dieses Ziel nicht ausgeführt.";
export const MISSING_TARGET_REASON = "Die Verbindung existiert nicht mehr.";

export function multiTargetGate(sql: string, entries: GatedTarget[]): MultiTargetGate {
  const kind = entries.find((entry) => entry.connection)?.connection?.kind;
  const write = writesData(sql, kind);
  const allowed: MultiTarget[] = [];
  const rejected: { target: MultiTarget; reason: string }[] = [];
  const production: MultiTarget[] = [];
  const readOnly: MultiTarget[] = [];
  for (const { target, connection } of entries) {
    if (!connection) {
      rejected.push({ target, reason: MISSING_TARGET_REASON });
      continue;
    }
    if (isProduction(connection)) production.push(target);
    const readOnlyTarget = Boolean(connection.readOnly);
    if (readOnlyTarget) readOnly.push(target);
    if (write && readOnlyTarget) {
      rejected.push({ target, reason: READ_ONLY_TARGET_REASON });
      continue;
    }
    if (write && isProductionLocked(connection)) {
      rejected.push({ target, reason: PRODUCTION_LOCK_MESSAGE });
      continue;
    }
    allowed.push(target);
  }
  return {
    write,
    allowed,
    rejected,
    production,
    readOnly,
    requiresConfirmation: write && allowed.length > 0,
    requiresProductionConfirmation:
      write &&
      allowed.length > 0 &&
      (readOnly.length > 0 || allowed.some((target) => production.includes(target))),
  };
}
