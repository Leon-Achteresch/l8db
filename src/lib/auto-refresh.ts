export const AUTO_REFRESH_OFF = 0;

export const AUTO_REFRESH_INTERVALS = [AUTO_REFRESH_OFF, 5000, 15000, 30000] as const;

export type AutoRefreshInterval = (typeof AUTO_REFRESH_INTERVALS)[number];

export type AutoRefreshConditions = {
  intervalMs: number;
  isTabVisible: boolean;
  isWindowVisible: boolean;
  isEditing: boolean;
  isSaving: boolean;
  isFetching: boolean;
  hasOpenTransaction: boolean;
};

export function isAutoRefreshInterval(value: number): value is AutoRefreshInterval {
  return (AUTO_REFRESH_INTERVALS as readonly number[]).includes(value);
}

export function normalizeAutoRefreshInterval(value: unknown): AutoRefreshInterval {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || !isAutoRefreshInterval(parsed)) return AUTO_REFRESH_OFF;
  return parsed;
}

export function describeAutoRefreshInterval(value: number): string {
  if (value <= 0) return "Aus";
  return `${Math.round(value / 1000)}s`;
}

export function autoRefreshPauseReason(conditions: AutoRefreshConditions): string | null {
  if (conditions.intervalMs <= 0) return null;
  if (!conditions.isWindowVisible) return "Fenster im Hintergrund";
  if (!conditions.isTabVisible) return "Tab nicht sichtbar";
  if (conditions.isEditing) return "Bearbeitung offen";
  if (conditions.isSaving) return "Speichern läuft";
  if (conditions.hasOpenTransaction) return "Transaktion offen";
  if (conditions.isFetching) return "Abfrage läuft";
  return null;
}

export function shouldAutoRefresh(conditions: AutoRefreshConditions): boolean {
  if (conditions.intervalMs <= 0) return false;
  return autoRefreshPauseReason(conditions) === null;
}
