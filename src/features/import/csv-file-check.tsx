import { CheckCircle2Icon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import type { useCsvFileCheck } from "./csv-import-panel/use-csv-file-check";

export function CsvFileCheck({
  check,
  importing,
}: {
  check: ReturnType<typeof useCsvFileCheck>;
  importing: boolean;
}) {
  const feature = useNewFeatureVisibility<HTMLButtonElement>("import.csv.file-check");
  if (!check.canCheck) return null;
  const report = check.report;
  const clean = report?.status === "complete" && report.error_count === 0;
  const label =
    report?.status === "changed"
      ? "Datei während der Prüfung geändert"
      : report?.status === "incomplete"
        ? "Dateiprüfung unvollständig"
        : report?.status === "cancelled"
          ? "Dateiprüfung abgebrochen"
          : clean
            ? "Keine Struktur-/NULL-Fehler"
            : "Dateiprüfung: Befunde";
  return (
    <section className="space-y-2 border-b px-4 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={feature.ref}
          size="sm"
          variant="outline"
          disabled={importing}
          onClick={() => (check.checking ? check.cancel() : void check.run())}
        >
          {check.checking ? <Spinner /> : <CheckCircle2Icon />}
          {check.checking ? "Prüfung abbrechen" : "CSV-Datei prüfen"}
          {feature.isNew && <NewBadge />}
        </Button>
        <span className="text-muted-foreground">Struktur / NULL · ohne Datenbankzugriff</span>
      </div>
      {check.error && (
        <p className="text-destructive" role="status">
          {check.error}
        </p>
      )}
      {report && (
        <div
          role="status"
          className={clean ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}
        >
          <p>
            {label} · {report.checked_rows.toLocaleString("de-DE")} Datensätze vollständig gelesen ·{" "}
            {report.error_count.toLocaleString("de-DE")} Befunde
          </p>
          <p className="text-muted-foreground">
            Serverregeln nicht geprüft · Stand{" "}
            {report.source_modified_ms === null
              ? "unbekannt"
              : new Date(report.source_modified_ms).toLocaleString("de-DE")}
          </p>
          <ul className="mt-1 space-y-1">
            {report.issues.map((issue) => (
              <li key={`${issue.row}:${issue.kind}:${issue.column ?? ""}`}>
                {issue.row === 0 ? "Kopfzeile" : `Datensatz ${issue.row}`}
                {issue.line > 0 ? ` · Dateizeile ${issue.line}` : ""}
                {issue.column ? ` · ${issue.column}` : ""}: {issue.message}
              </li>
            ))}
            {report.error_count > report.issues.length && (
              <li>
                {(report.error_count - report.issues.length).toLocaleString("de-DE")} weitere
                Befunde
              </li>
            )}
          </ul>
        </div>
      )}
    </section>
  );
}
