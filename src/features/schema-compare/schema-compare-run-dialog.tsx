import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  FlaskConicalIcon,
  LoaderIcon,
  PlayIcon,
  SquareIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  dryRunKind,
  type RunStep,
  type RunSummary,
  runSyncStatements,
} from "@/lib/schema-compare/run";
import type { SyncStatement } from "@/lib/schema-compare/script";
import { prepareConnection, runSchemaCompare } from "@/lib/schema-compare/store";
import type { CompareResult } from "@/lib/schema-compare/types";
import { cn } from "@/lib/utils";

interface SchemaCompareRunDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  result: CompareResult;
  statements: SyncStatement[];
}

const STEP_ICON = {
  pending: { Icon: CircleDashedIcon, color: "text-muted-foreground" },
  running: { Icon: LoaderIcon, color: "animate-spin text-sky-500" },
  ok: { Icon: CircleCheckIcon, color: "text-emerald-500" },
  warning: { Icon: TriangleAlertIcon, color: "text-amber-500" },
  error: { Icon: CircleXIcon, color: "text-destructive" },
  skipped: { Icon: CircleDashedIcon, color: "text-muted-foreground/50" },
};

function statementCount(count: number): string {
  return `${count} ${count === 1 ? "Anweisung" : "Anweisungen"}`;
}

function firstLine(sql: string): string {
  return sql.split("\n")[0].slice(0, 160);
}

function outcomeText(summary: RunSummary): string {
  if (summary.blocked)
    return "Nicht ausgeführt: Die Datenprüfung hat Konflikte mit vorhandenen Daten gefunden. Es wurde nichts geändert.";
  if (summary.dryRun && !summary.rolledBack) {
    if (summary.failed > 0)
      return `Datenprüfung: ${statementCount(summary.failed)} ${summary.failed === 1 ? "würde" : "würden"} an vorhandenen Daten scheitern. Es wurde nichts geändert.`;
    if (summary.checked === 0)
      return "Keine Anweisung braucht eine Datenprüfung. Es wurde nichts geändert.";
    return `Datenprüfung ohne Befund: Die vorhandenen Daten passen zu ${statementCount(summary.checked)}. Es wurde nichts geändert.`;
  }
  if (summary.dryRun) {
    if (summary.failed > 0)
      return "Probelauf fehlgeschlagen. Die markierte Anweisung würde beim Ausführen scheitern. Es wurde nichts geändert.";
    if (summary.incomplete)
      return "Probelauf nur teilweise möglich. Bis zur markierten Stelle lief alles fehlerfrei; alles wurde zurückgerollt.";
    return "Probelauf erfolgreich: Alle Anweisungen liefen fehlerfrei und wurden wieder zurückgerollt. Es wurde nichts geändert.";
  }
  if (summary.rolledBack) return "Fehler: Die Transaktion wurde vollständig zurückgerollt.";
  if (summary.failed > 0) return `${statementCount(summary.failed)} fehlgeschlagen.`;
  return "Alle Anweisungen wurden ausgeführt.";
}

export function SchemaCompareRunDialog({
  open,
  onOpenChange,
  result,
  statements,
}: SchemaCompareRunDialogProps) {
  const target = result.target;
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [running, setRunning] = useState<"dry" | "real" | null>(null);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [executed, setExecuted] = useState(false);
  const [continueOnError, setContinueOnError] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const stop = useRef(false);
  const oracle = result.kind === "oracle";
  const dryRun = dryRunKind(result.kind);
  const dangerous = statements.filter((statement) => statement.dangerous);
  const confirmed = dangerous.length === 0 || confirmation.trim() === result.targetSchema;
  const done = steps.filter(
    (step) => step.status !== "pending" && step.status !== "running",
  ).length;

  const reset = () => {
    setSteps([]);
    setSummary(null);
    setError(null);
    setExecuted(false);
    setConfirmation("");
    stop.current = false;
  };

  const execute = async (dryRun: boolean) => {
    if (!target.connectionId) return;
    setSteps(statements.map(() => ({ status: "pending", message: null })));
    setSummary(null);
    setError(null);
    stop.current = false;
    setRunning(dryRun ? "dry" : "real");
    if (!dryRun) setExecuted(true);
    try {
      const connection = await prepareConnection(target.connectionId);
      const outcome = await runSyncStatements(
        connection,
        { database: target.database, schema: result.targetSchema },
        statements,
        {
          continueOnError,
          dryRun,
          stopped: () => stop.current,
          onStep: (index, step) =>
            setSteps((current) =>
              current.map((item, position) => (position === index ? step : item)),
            ),
        },
      );
      setSummary(outcome);
      if (outcome.blocked) setExecuted(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(null);
    }
  };

  const close = (next: boolean) => {
    if (running) return;
    if (!next) {
      if (executed) void runSchemaCompare();
      reset();
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sync-Skript ausführen</DialogTitle>
          <DialogDescription>
            {statementCount(statements.length)} für <strong>{result.targetLabel}</strong>. Die
            Objekte werden dort so angelegt oder geändert, wie sie in{" "}
            <strong>{result.sourceLabel}</strong> sind.
          </DialogDescription>
        </DialogHeader>

        {!executed && (
          <div className="flex min-w-0 flex-col gap-3 text-xs">
            <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/30 px-3 py-2">
              {dryRun === "rollback" ? (
                <>
                  <p>
                    <strong>Probelauf:</strong> führt das Skript in einer Transaktion aus und rollt
                    danach alles zurück. So sehen Sie vorher, ob jede Anweisung fehlerfrei läuft. Es
                    wird nichts geändert; betroffene Tabellen sind während des Probelaufs kurz
                    gesperrt.
                  </p>
                  <p>
                    <strong>Ausführen:</strong> alle Anweisungen laufen in einer Transaktion. Bei
                    einem Fehler wird alles zurückgerollt. Neue Enum-Werte werden vorab
                    festgeschrieben, weil PostgreSQL sie sonst nicht verwenden kann.
                  </p>
                </>
              ) : (
                <>
                  <p>
                    <strong>Kein vollständiger Probelauf möglich:</strong> Oracle schreibt jede
                    DDL-Anweisung sofort fest, ein Rollback ist nicht möglich.
                  </p>
                  <p>
                    <strong>Datenprüfung:</strong> prüft vorher nur lesend, ob vorhandene Daten neue
                    Constraints, NOT NULL oder kürzere Spalten verletzen. Sie läuft vor dem
                    Ausführen automatisch; bei Konflikten wird nichts ausgeführt.
                  </p>
                  <p>
                    PL/SQL-Objekte mit Kompilierfehlern werden als Warnung gemeldet und am Ende neu
                    kompiliert.
                  </p>
                </>
              )}
            </div>
            {oracle && (
              <Label className="flex items-center gap-2 text-xs font-normal">
                <Checkbox
                  checked={continueOnError}
                  disabled={Boolean(running)}
                  onCheckedChange={(checked) => setContinueOnError(checked === true)}
                />
                Bei Fehlern mit der nächsten Anweisung fortfahren
              </Label>
            )}
            {dangerous.length > 0 && (
              <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2">
                <p className="font-medium text-destructive">
                  {statementCount(dangerous.length)} {dangerous.length === 1 ? "kann" : "können"}{" "}
                  Daten löschen oder verändern:
                </p>
                <ul className="max-h-32 overflow-auto font-mono text-[11px]">
                  {dangerous.map((statement) => (
                    <li key={statement.sql} className="truncate">
                      {firstLine(statement.sql)}
                    </li>
                  ))}
                </ul>
                <Label className="flex flex-col items-start gap-1 text-xs font-normal">
                  <span>
                    Zum Ausführen den Zielschema-Namen <strong>{result.targetSchema}</strong>{" "}
                    eingeben
                    {dryRun && " (für die Prüfung nicht nötig)"}
                  </span>
                  <Input
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    className="h-8 font-mono text-xs"
                    aria-label="Zielschema bestätigen"
                    disabled={Boolean(running)}
                  />
                </Label>
              </div>
            )}
          </div>
        )}

        {steps.length > 0 && (
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            <span className="text-xs font-medium">
              {running === "dry" || (!running && (summary?.dryRun || summary?.blocked))
                ? dryRun === "rollback"
                  ? "Probelauf (wird zurückgerollt)"
                  : "Datenprüfung (nur lesend)"
                : "Ausführung"}
            </span>
            <Progress value={statements.length ? (done / statements.length) * 100 : 0} />
            <ol className="max-h-[40vh] overflow-auto rounded-lg border text-xs">
              {statements.map((statement, index) => {
                const step = steps[index] ?? { status: "pending", message: null };
                const { Icon, color } = STEP_ICON[step.status];
                return (
                  <li
                    key={statement.sql}
                    className="flex flex-col gap-0.5 border-b px-2 py-1 last:border-0"
                  >
                    <span className="flex items-center gap-2">
                      <Icon className={cn("size-3.5 shrink-0", color)} />
                      <span className="truncate font-mono">{firstLine(statement.sql)}</span>
                    </span>
                    {step.message && (
                      <span
                        className={cn(
                          "whitespace-pre-wrap pl-5.5 font-mono text-[11px]",
                          step.status === "error"
                            ? "text-destructive"
                            : step.status === "skipped"
                              ? "text-muted-foreground"
                              : "text-amber-600",
                        )}
                      >
                        {step.message}
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
            {summary && (
              <div
                role="status"
                className={cn(
                  "rounded-lg border px-3 py-2 text-xs",
                  summary.failed > 0
                    ? "border-destructive/40 bg-destructive/5 text-destructive"
                    : summary.incomplete
                      ? "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400"
                      : "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
                )}
              >
                {outcomeText(summary)}
                {summary.warnings > 0 &&
                  !summary.dryRun &&
                  ` ${summary.warnings} mit Kompilierwarnungen.`}
                {summary.invalid.length > 0 && (
                  <div className="mt-1 text-amber-600">
                    Nach dem Neukompilieren noch ungültig:{" "}
                    {summary.invalid.map((item) => `${item.object_type} ${item.name}`).join(", ")}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {error && <p className="whitespace-pre-wrap text-xs text-destructive">{error}</p>}

        <DialogFooter>
          {running ? (
            <Button variant="outline" onClick={() => (stop.current = true)}>
              <SquareIcon className="size-3.5" />
              Anhalten
            </Button>
          ) : executed ? (
            <Button onClick={() => close(false)}>Schließen und neu vergleichen</Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)}>
                {summary || error ? "Schließen" : "Abbrechen"}
              </Button>
              {dryRun && (
                <Button
                  variant="secondary"
                  disabled={statements.length === 0}
                  title={
                    dryRun === "rollback"
                      ? "Skript testweise ausführen und zurückrollen"
                      : "Vorhandene Daten gegen das Skript prüfen, ohne etwas zu ändern"
                  }
                  onClick={() => void execute(true)}
                >
                  <FlaskConicalIcon className="size-3.5" />
                  {dryRun === "rollback" ? "Probelauf" : "Datenprüfung"}
                  {(summary?.dryRun || summary?.blocked) && " wiederholen"}
                </Button>
              )}
              <Button
                variant={dangerous.length > 0 ? "destructive" : "default"}
                disabled={!confirmed || statements.length === 0}
                onClick={() => void execute(false)}
              >
                <PlayIcon className="size-3.5" />
                Ausführen
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
