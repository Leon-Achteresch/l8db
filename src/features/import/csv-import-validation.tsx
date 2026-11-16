import { NewBadge } from "@/components/new-badge";
import type { CsvMappingIssues } from "@/lib/csv-import";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function CsvImportValidation({ issues }: { issues: CsvMappingIssues }) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("import.csv.null-preflight");
  const errors = [...new Set(issues.errors)];
  const warnings = [...new Set(issues.warnings)].slice(0, 10);
  return (
    <div ref={feature.ref} className="space-y-1 border-b px-4 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        <span>Zuordnung / NULL-Prüfung</span>
        {feature.isNew && <NewBadge />}
        <span className="tabular-nums">
          {issues.checkedRows.toLocaleString("de-DE")} geladene Datensätze ·{" "}
          {issues.errorCount.toLocaleString("de-DE")} Fehler
        </span>
      </div>
      <ul className="space-y-1">
        {errors.map((error) => (
          <li key={error} className="text-destructive">
            {error}
          </li>
        ))}
        {issues.errorCount > errors.length && (
          <li className="text-destructive tabular-nums">
            {(issues.errorCount - errors.length).toLocaleString("de-DE")} weitere Fehler
          </li>
        )}
        {warnings.map((warning) => (
          <li key={warning} className="text-amber-700 dark:text-amber-400">
            {warning}
          </li>
        ))}
      </ul>
    </div>
  );
}
