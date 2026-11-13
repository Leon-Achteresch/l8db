import type { HealthCategory, HealthCheckResult, HealthSeverity } from "@/lib/db";

export type HealthGroup = HealthSeverity | "skipped" | "ok";

export const GROUP_ORDER: HealthGroup[] = ["critical", "warning", "info", "skipped", "ok"];

export const GROUP_LABEL: Record<HealthGroup, string> = {
  critical: "Kritisch",
  warning: "Warnung",
  info: "Hinweis",
  skipped: "Übersprungen",
  ok: "In Ordnung",
};

export const GROUP_DOT: Record<HealthGroup, string> = {
  critical: "bg-destructive",
  warning: "bg-amber-500",
  info: "bg-sky-500",
  skipped: "bg-muted-foreground/40",
  ok: "bg-emerald-500",
};

export function groupOf(check: HealthCheckResult): HealthGroup {
  if (check.status === "issue") return check.severity ?? "info";
  return check.status === "skipped" ? "skipped" : "ok";
}

export const CATEGORY_LABEL: Record<HealthCategory, string> = {
  security: "Sicherheit",
  performance: "Performance",
  schema: "Schema",
};

export function sortChecks(checks: HealthCheckResult[]): HealthCheckResult[] {
  const rank = (check: HealthCheckResult) => GROUP_ORDER.indexOf(groupOf(check));
  return [...checks].sort((a, b) => rank(a) - rank(b));
}
