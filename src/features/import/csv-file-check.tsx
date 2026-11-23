import { CheckCircle2Icon, RotateCcwIcon, UploadIcon } from "lucide-react";
import { type ComponentProps, type ComponentType, useId } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import type { useCsvFileCheck } from "./csv-import-panel/use-csv-file-check";

type Check = ReturnType<typeof useCsvFileCheck>;
type Tone = "idle" | "busy" | "ok" | "warn" | "bad";
type Phase = "ready" | "running" | "done";

const DOT: Record<Tone, string> = {
  idle: "bg-muted-foreground/40",
  busy: "",
  ok: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-destructive",
};

const TEXT: Record<Tone, string> = {
  idle: "text-muted-foreground",
  busy: "text-muted-foreground",
  ok: "text-emerald-700 dark:text-emerald-400",
  warn: "text-amber-700 dark:text-amber-400",
  bad: "text-destructive",
};

const ACTION: Record<Phase, { label: string; Icon: ComponentType<ComponentProps<"svg">> }> = {
  ready: { label: "CSV-Datei prüfen", Icon: CheckCircle2Icon },
  running: { label: "Prüfung abbrechen", Icon: Spinner },
  done: { label: "Erneut prüfen", Icon: RotateCcwIcon },
};

const count = (value: number) => value.toLocaleString("de-DE");

function describe(check: Check): {
  tone: Tone;
  phase: Phase;
  title: string;
  repick?: boolean;
  issues?: boolean;
} {
  const report = check.report;
  if (check.checking)
    return check.cancelling
      ? { tone: "busy", phase: "running", title: "Abbruch angefordert…" }
      : { tone: "busy", phase: "running", title: "Prüft die ganze Datei…" };
  if (check.error) return { tone: "bad", phase: "done", title: "Prüfung fehlgeschlagen" };
  if (check.cancelled)
    return { tone: "warn", phase: "done", title: "Abgebrochen · keine Freigabe" };
  if (!report)
    return {
      tone: "idle",
      phase: "ready",
      title: "Ganze Datei · Struktur und NULL · ohne Datenbankzugriff",
    };
  if (report.status === "changed")
    return {
      tone: "warn",
      phase: "done",
      title: "Datei während der Prüfung geändert · Ergebnis verworfen",
      repick: true,
    };
  if (report.status === "cancelled")
    return { tone: "warn", phase: "done", title: "Abgebrochen · keine Freigabe", issues: true };
  if (report.status === "incomplete")
    return {
      tone: "bad",
      phase: "done",
      title: "Unvollständig · Datei nicht bis zum Ende lesbar",
      repick: true,
      issues: true,
    };
  if (report.error_count === 0)
    return { tone: "ok", phase: "done", title: "Keine Struktur- oder NULL-Befunde" };
  return {
    tone: "bad",
    phase: "done",
    title: `${count(report.error_count)} ${report.error_count === 1 ? "Befund" : "Befunde"}`,
    repick: true,
    issues: true,
  };
}

export function CsvFileCheck({
  check,
  importing,
  onPickFile,
}: {
  check: Check;
  importing: boolean;
  onPickFile?: () => void;
}) {
  const feature = useNewFeatureVisibility<HTMLButtonElement>("import.csv.file-check");
  const titleId = useId();
  if (!check.canCheck) return null;
  const report = check.report;
  const status = describe(check);
  const rest = report ? report.error_count - report.issues.length : 0;
  const read = report && report.status !== "changed";
  const action = ACTION[status.phase];
  const quiet = status.phase === "done" && (status.tone === "ok" || status.repick);
  return (
    <section aria-labelledby={titleId} className="border-b text-xs">
      <div className="flex min-h-9 flex-wrap items-center gap-x-2 gap-y-1 px-4 py-1">
        <h3 id={titleId} className="font-semibold">
          Dateiprüfung
        </h3>
        <p role="status" className={cn("flex min-w-0 items-center gap-1.5", TEXT[status.tone])}>
          {status.tone === "busy" ? (
            <Spinner aria-hidden className="size-3" />
          ) : (
            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", DOT[status.tone])} />
          )}
          <span className="min-w-0">
            {status.title}
            {check.checking && (
              <span className="tabular-nums">
                {" "}
                ·{" "}
                {check.checkedRows === null
                  ? "Datensätze unbekannt"
                  : `${count(check.checkedRows)} Datensätze gelesen`}
              </span>
            )}
          </span>
        </p>
        <div className="ml-auto flex items-center gap-1.5">
          {status.repick && onPickFile && (
            <Button size="sm" variant="outline" disabled={importing} onClick={onPickFile}>
              <UploadIcon />
              Datei neu wählen
            </Button>
          )}
          <Button
            ref={feature.ref}
            size="sm"
            variant={quiet ? "ghost" : "outline"}
            disabled={importing}
            aria-disabled={check.cancelling || undefined}
            className="aria-disabled:opacity-50"
            onClick={() => (check.checking ? check.cancel() : void check.run())}
          >
            <action.Icon aria-hidden />
            {action.label}
            {feature.isNew && <NewBadge />}
          </Button>
        </div>
      </div>
      {check.error && (
        <p className="mx-4 mb-2 break-words rounded-md bg-destructive/5 px-3 py-1.5 font-mono text-destructive">
          {check.error}
        </p>
      )}
      {read && (
        <p className="px-4 pb-2 text-muted-foreground tabular-nums">
          {count(report.checked_rows)} Datensätze gelesen · Dateistand{" "}
          {report.source_modified_ms === null
            ? "unbekannt"
            : new Date(report.source_modified_ms).toLocaleString("de-DE")}
          {report.status === "complete" &&
            " · Nicht geprüft: Datentypen, Unique, Fremdschlüssel, Trigger, Serverimport"}
        </p>
      )}
      {status.issues && report && report.issues.length > 0 && (
        <div className="mx-4 mb-2 overflow-x-auto rounded-md bg-muted/40 px-3 py-1.5">
          <table className="w-full text-left tabular-nums">
            <caption className="sr-only">
              Erste {report.issues.length} von {count(report.error_count)} Befunden
            </caption>
            <thead className="text-[11px] text-muted-foreground">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium whitespace-nowrap">
                  Datensatz
                </th>
                <th scope="col" className="py-1 pr-3 font-medium whitespace-nowrap">
                  Dateizeile
                </th>
                <th scope="col" className="w-full min-w-40 py-1 font-medium">
                  Befund
                </th>
              </tr>
            </thead>
            <tbody>
              {report.issues.map((issue) => (
                <tr key={`${issue.row}:${issue.kind}:${issue.column ?? ""}`} className="align-top">
                  <td className="py-0.5 pr-3 whitespace-nowrap">
                    {issue.row === 0 ? "Kopfzeile" : count(issue.row)}
                  </td>
                  <td className="py-0.5 pr-3 whitespace-nowrap">
                    {issue.line > 0 ? (
                      count(issue.line)
                    ) : (
                      <>
                        <span aria-hidden className="text-muted-foreground">
                          –
                        </span>
                        <span className="sr-only">unbekannt</span>
                      </>
                    )}
                  </td>
                  <td className="py-0.5">
                    {issue.column && (
                      <span className="mr-1 font-mono break-all">{issue.column}</span>
                    )}{" "}
                    {issue.message}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rest > 0 && (
            <p className="py-1 text-muted-foreground tabular-nums">
              +{count(rest)} weitere {rest === 1 ? "Befund" : "Befunde"}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
