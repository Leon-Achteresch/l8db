import type { HealthCategory, HealthCheckResult, HealthSeverity } from "@/lib/db";

export const SEVERITY_ORDER: HealthSeverity[] = ["critical", "warning", "info"];

export const SEVERITY_LABEL: Record<HealthSeverity, string> = {
  critical: "Kritisch",
  warning: "Warnung",
  info: "Hinweis",
};

export const SEVERITY_CLASS: Record<HealthSeverity, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/30",
  warning: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30",
  info: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/30",
};

export const CATEGORY_LABEL: Record<HealthCategory, string> = {
  security: "Sicherheit",
  performance: "Performance",
  schema: "Schema",
};

export function sortChecks(checks: HealthCheckResult[]): HealthCheckResult[] {
  const rank = (check: HealthCheckResult) =>
    check.status === "issue" && check.severity
      ? SEVERITY_ORDER.indexOf(check.severity)
      : check.status === "skipped"
        ? SEVERITY_ORDER.length
        : SEVERITY_ORDER.length + 1;
  return [...checks].sort((a, b) => rank(a) - rank(b));
}
