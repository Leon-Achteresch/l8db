import type { AlertStatus, RunStatus, TriggerKind, WebhookKind } from "@/lib/db/automation";

export type StatusTone = "running" | "success" | "warning" | "danger" | "neutral";

const STATUS_LABELS: Record<RunStatus, string> = {
  running: "läuft",
  success: "erfolgreich",
  warning: "mit Warnungen",
  failed: "fehlgeschlagen",
  cancelled: "abgebrochen",
  timeout: "Zeitüberschreitung",
  skipped: "übersprungen",
  interrupted: "unterbrochen",
};

const STATUS_TONES: Record<RunStatus, StatusTone> = {
  running: "running",
  success: "success",
  warning: "warning",
  failed: "danger",
  cancelled: "neutral",
  timeout: "danger",
  skipped: "neutral",
  interrupted: "warning",
};

const TRIGGER_LABELS: Record<TriggerKind, string> = {
  manual: "manuell",
  schedule: "Zeitplan",
  app_start: "App-Start",
  after_task: "nach Task",
  cli: "Kommandozeile",
  background: "Hintergrund",
  run_task: "aus Task",
  rerun: "erneut ausgeführt",
};

const ALERT_LABELS: Record<AlertStatus, string> = {
  unknown: "Unbekannt",
  ok: "OK",
  triggered: "Ausgelöst",
  error: "Fehler",
};

const ALERT_TONES: Record<AlertStatus, StatusTone> = {
  unknown: "neutral",
  ok: "success",
  triggered: "danger",
  error: "warning",
};

export const RUN_STATUSES = Object.keys(STATUS_LABELS) as RunStatus[];
export const TRIGGER_KINDS = Object.keys(TRIGGER_LABELS) as TriggerKind[];

export function runStatusLabel(status: RunStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export function runStatusTone(status: RunStatus | null | undefined): StatusTone {
  return status ? (STATUS_TONES[status] ?? "neutral") : "neutral";
}

export function triggerLabel(trigger: TriggerKind): string {
  return TRIGGER_LABELS[trigger] ?? trigger;
}

export function alertStatusLabel(status: AlertStatus): string {
  return ALERT_LABELS[status] ?? status;
}

export function alertStatusTone(status: AlertStatus): StatusTone {
  return ALERT_TONES[status] ?? "neutral";
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "–";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  const seconds = ms / 1000;
  if (seconds < 10) return `${seconds.toFixed(1).replace(".", ",")} s`;
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  if (minutes < 60) return rest ? `${minutes} Min. ${rest} s` : `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  return restMinutes ? `${hours} Std. ${restMinutes} Min.` : `${hours} Std.`;
}

export function formatRelative(value: string | number | Date | null | undefined, now = Date.now()) {
  if (value == null) return "–";
  const at = new Date(value).getTime();
  if (!Number.isFinite(at)) return "–";
  const diff = at - now;
  const future = diff > 0;
  const minutes = Math.round(Math.abs(diff) / 60_000);
  if (minutes < 1) return future ? "gleich" : "gerade eben";
  const wrap = (text: string) => (future ? `in ${text}` : `vor ${text}`);
  if (minutes < 60) return wrap(`${minutes} Min.`);
  const hours = Math.round(minutes / 60);
  if (hours < 24) return wrap(`${hours} Std.`);
  const days = Math.round(hours / 24);
  if (days === 1) return future ? "morgen" : "gestern";
  if (days < 30) return wrap(`${days} Tagen`);
  return formatDateTime(at);
}

const DATE_TIME = new Intl.DateTimeFormat("de-DE", {
  weekday: "short",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const TIME = new Intl.DateTimeFormat("de-DE", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const CLOCK = new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" });

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value == null) return "–";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? DATE_TIME.format(date) : "–";
}

export function formatTime(value: string | number | Date | null | undefined): string {
  if (value == null) return "–";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? TIME.format(date) : "–";
}

export function formatClock(value: string | number | Date | null | undefined): string {
  if (value == null) return "–";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? CLOCK.format(date) : "–";
}

export function formatBytesShort(bytes: number | null | undefined): string {
  if (bytes == null) return "–";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value < 10 ? 1 : 0).replace(".", ",")} ${units[unit]}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "–";
  return `${Math.round(value * 100)} %`;
}

export const WEBHOOK_KINDS: { value: WebhookKind; label: string; placeholder: string }[] = [
  { value: "slack", label: "Slack", placeholder: "https://hooks.slack.com/services/…" },
  { value: "teams", label: "Microsoft Teams", placeholder: "https://….webhook.office.com/…" },
  { value: "discord", label: "Discord", placeholder: "https://discord.com/api/webhooks/…" },
  { value: "generic", label: "Eigener Endpunkt", placeholder: "https://example.com/hooks/l8db" },
];
