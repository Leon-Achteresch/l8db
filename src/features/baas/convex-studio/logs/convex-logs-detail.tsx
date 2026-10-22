import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { copyWithToast } from "@/lib/clipboard";
import { cn } from "@/lib/utils";
import {
  type ConvexExecution,
  executionStatus,
  formatDuration,
  formatLogTime,
  LEVEL_CLASS,
} from "./convex-logs-buffer";

export function ConvexLogsDetail({
  execution,
  onClose,
  onRequest,
}: {
  execution: ConvexExecution | null;
  onClose: () => void;
  onRequest: (requestId: string) => void;
}) {
  const fields: [string, string][] = execution
    ? [
        ["Zeitpunkt", new Date(execution.timestampMs).toLocaleString("de-DE")],
        ["Funktion", execution.identifier],
        ["Typ", execution.udfType],
        ["Status", executionStatus(execution)],
        ["Dauer", formatDuration(execution.executionTimeMs)],
        ["Benutzercode", formatDuration(execution.userExecutionTimeMs)],
        ["Aus Cache", execution.cached ? "ja" : "nein"],
        ["Auslöser", execution.caller ?? "–"],
        ["Umgebung", execution.environment ?? "–"],
        ["Komponente", execution.componentPath ?? "–"],
        ["Request-ID", execution.requestId || "–"],
        ["Ausführungs-ID", execution.executionId || "–"],
        ["Übergeordnet", execution.parentExecutionId ?? "–"],
        [
          "Rückgabe",
          execution.returnBytes === null
            ? "–"
            : `${execution.returnBytes.toLocaleString("de-DE")} B`,
        ],
      ]
    : [];
  const usage = Object.entries(execution?.usage ?? {}).filter(([, value]) => value);
  return (
    <Sheet open={execution !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl data-[side=right]:sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="font-mono text-sm">{execution?.identifier}</SheetTitle>
          <SheetDescription>
            {execution
              ? `${formatLogTime(execution.timestampMs)} · ${executionStatus(execution)}`
              : ""}
          </SheetDescription>
        </SheetHeader>
        {execution && (
          <div className="space-y-4 px-4 pb-6">
            <dl className="grid grid-cols-[140px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
              {fields.map(([label, value]) => (
                <div key={label} className="contents">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="truncate font-mono" title={value}>
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
            {execution.error && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-destructive">Fehler</p>
                <pre className="max-h-64 overflow-auto rounded-md bg-destructive/10 p-3 font-mono text-xs whitespace-pre-wrap break-all text-destructive">
                  {execution.error}
                </pre>
              </div>
            )}
            <div className="space-y-1">
              <p className="text-xs font-medium">
                Logzeilen ({execution.lines.length}
                {execution.linesDropped ? `, ${execution.linesDropped} ausgelassen` : ""})
              </p>
              {execution.lines.length === 0 ? (
                <p className="text-xs text-muted-foreground">Keine Logzeilen.</p>
              ) : (
                <div className="max-h-80 overflow-auto rounded-md border font-mono text-xs">
                  {execution.lines.map((line, index) => (
                    <div
                      key={`${index}-${line.timestampMs}`}
                      className="flex gap-2 border-b px-2 py-1 last:border-b-0"
                    >
                      <span className="shrink-0 text-muted-foreground tabular-nums">
                        {line.timestampMs ? formatLogTime(line.timestampMs) : ""}
                      </span>
                      <span className={cn("w-12 shrink-0", LEVEL_CLASS[line.level])}>
                        {line.level}
                      </span>
                      <span className="min-w-0 flex-1 whitespace-pre-wrap break-all">
                        {line.message}
                      </span>
                      {line.truncated && (
                        <Badge variant="outline" className="h-4 px-1 text-[10px]">
                          gekürzt
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {usage.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs font-medium">Ressourcen</p>
                <dl className="grid grid-cols-[220px_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs">
                  {usage.map(([key, value]) => (
                    <div key={key} className="contents">
                      <dt className="text-muted-foreground">{key}</dt>
                      <dd className="font-mono tabular-nums">{value.toLocaleString("de-DE")}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              {execution.requestId && (
                <Button size="sm" variant="outline" onClick={() => onRequest(execution.requestId)}>
                  Request anzeigen
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void copyWithToast(JSON.stringify(execution, null, 2), "JSON")}
              >
                JSON kopieren
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
