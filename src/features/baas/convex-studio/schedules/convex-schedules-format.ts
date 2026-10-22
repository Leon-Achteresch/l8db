const dateFormat = new Intl.DateTimeFormat("de-DE", {
  dateStyle: "short",
  timeStyle: "medium",
});

export function formatScheduleTime(ms: number | null | undefined) {
  return ms == null ? "–" : dateFormat.format(new Date(ms));
}

export function formatRelative(ms: number | null | undefined, now = Date.now()) {
  if (ms == null) return "";
  const seconds = Math.round((ms - now) / 1000);
  const abs = Math.abs(seconds);
  const [value, unit] =
    abs < 60
      ? [abs, "s"]
      : abs < 3600
        ? [Math.round(abs / 60), "min"]
        : abs < 86_400
          ? [Math.round(abs / 3600), "h"]
          : [Math.round(abs / 86_400), "d"];
  return seconds >= 0 ? `in ${value} ${unit}` : `vor ${value} ${unit}`;
}

export const JOB_STATES: Record<string, string> = {
  pending: "Ausstehend",
  inProgress: "Läuft",
  success: "Erfolgreich",
  failed: "Fehlgeschlagen",
  canceled: "Abgebrochen",
};

export const CRON_STATUS: Record<string, string> = {
  success: "Erfolgreich",
  err: "Fehlgeschlagen",
  canceled: "Übersprungen",
};

export function formatJson(value: unknown) {
  return value === undefined || value === null ? "{}" : JSON.stringify(value, null, 2);
}

export const AUTO_REFRESH_OPTIONS = [
  { value: "0", label: "Auto-Refresh aus" },
  { value: "5000", label: "Alle 5 s" },
  { value: "15000", label: "Alle 15 s" },
  { value: "60000", label: "Jede Minute" },
];
