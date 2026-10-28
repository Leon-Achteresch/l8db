export const SERVICE_LABELS: Record<string, string> = {
  auth: "Auth",
  db: "PostgreSQL",
  pooler: "Pooler",
  realtime: "Realtime",
  rest: "Data API",
  storage: "Storage",
};

export function serviceLabel(name: string) {
  return SERVICE_LABELS[name] ?? name;
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: "Aktiv",
  ACTIVE_HEALTHY: "Aktiv",
  ACTIVE_UNHEALTHY: "Gestört",
  UNHEALTHY: "Gestört",
  COMING_UP: "Startet",
  GOING_DOWN: "Fährt herunter",
  INACTIVE: "Pausiert",
  PAUSING: "Wird pausiert",
  RESTORING: "Wird wiederhergestellt",
  RESTARTING: "Startet neu",
  UPGRADING: "Wird aktualisiert",
  INIT_FAILED: "Start fehlgeschlagen",
  REMOVED: "Entfernt",
  THROTTLED: "Gedrosselt",
};

export function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}
