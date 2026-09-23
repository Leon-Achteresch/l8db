import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
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
import { type RunStep, type RunSummary, runSyncStatements } from "@/lib/schema-compare/run";
import type { SyncStatement } from "@/lib/schema-compare/script";
import {
  prepareConnection,
  runSchemaCompare,
  useSchemaCompareStore,
} from "@/lib/schema-compare/store";
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

export function SchemaCompareRunDialog({
  open,
  onOpenChange,
  result,
  statements,
}: SchemaCompareRunDialogProps) {
  const target = useSchemaCompareStore((state) => state.target);
  const [steps, setSteps] = useState<RunStep[]>([]);
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [continueOnError, setContinueOnError] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const stop = useRef(false);
  const oracle = result.kind === "oracle";
  const dangerous = statements.filter((statement) => statement.dangerous);
  const confirmed = dangerous.length === 0 || confirmation.trim() === result.targetSchema;
  const started = steps.length > 0;
  const done = steps.filter(
    (step) => step.status !== "pending" && step.status !== "running",
  ).length;

  const reset = () => {
    setSteps([]);
    setSummary(null);
    setError(null);
    setConfirmation("");
    stop.current = false;
  };

  const execute = async () => {
    if (!target.connectionId) return;
    reset();
    setRunning(true);
    setSteps(statements.map(() => ({ status: "pending", message: null })));
    try {
      const connection = await prepareConnection(target.connectionId);
      const outcome = await runSyncStatements(
        connection,
        { database: target.database, schema: result.targetSchema },
        statements,
        {
          continueOnError,
          stopped: () => stop.current,
          onStep: (index, step) =>
            setSteps((current) =>
              current.map((item, position) => (position === index ? step : item)),
            ),
        },
      );
      setSummary(outcome);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRunning(false);
    }
  };

  const close = (next: boolean) => {
    if (running) return;
    if (!next) reset();
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Sync-Skript im Ziel ausführen</DialogTitle>
          <DialogDescription>
            {statementCount(statements.length)} {statements.length === 1 ? "wird" : "werden"} in{" "}
            <strong>{result.targetLabel}</strong> ausgeführt.
          </DialogDescription>
        </DialogHeader>

        {!started && (
          <div className="flex min-w-0 flex-col gap-3 text-xs">
            <p className="rounded-lg border bg-muted/30 px-3 py-2">
              {oracle
                ? "Oracle schreibt DDL sofort fest; ein Rollback ist nicht möglich. PL/SQL-Objekte mit Kompilierfehlern werden als Warnung gemeldet und am Ende neu kompiliert."
                : "Alle Anweisungen laufen in einer Transaktion. Bei einem Fehler wird alles zurückgerollt. Neue Enum-Werte werden vorab festgeschrieben, weil PostgreSQL sie sonst nicht verwenden kann."}
            </p>
            {oracle && (
              <Label className="flex items-center gap-2 text-xs font-normal">
                <Checkbox
                  checked={continueOnError}
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
                    Zur Bestätigung den Zielschema-Namen <strong>{result.targetSchema}</strong>{" "}
                    eingeben
                  </span>
                  <Input
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    className="h-8 font-mono text-xs"
                    aria-label="Zielschema bestätigen"
                  />
                </Label>
              </div>
            )}
          </div>
        )}

        {started && (
          <div className="flex min-h-0 min-w-0 flex-col gap-2">
            <Progress value={statements.length ? (done / statements.length) * 100 : 0} />
            <ol className="max-h-[45vh] overflow-auto rounded-lg border text-xs">
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
                          step.status === "error" ? "text-destructive" : "text-amber-600",
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
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-xs">
                {summary.rolledBack
                  ? "Fehler: Die Transaktion wurde vollständig zurückgerollt."
                  : summary.failed > 0
                    ? `${statementCount(summary.failed)} fehlgeschlagen.`
                    : "Alle Anweisungen wurden ausgeführt."}
                {summary.warnings > 0 && ` ${summary.warnings} mit Kompilierwarnungen.`}
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
          ) : summary || error ? (
            <>
              <Button variant="outline" onClick={() => close(false)}>
                Schließen
              </Button>
              <Button
                onClick={() => {
                  close(false);
                  void runSchemaCompare();
                }}
              >
                Erneut vergleichen
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => close(false)}>
                Abbrechen
              </Button>
              <Button
                variant={dangerous.length > 0 ? "destructive" : "default"}
                disabled={!confirmed || statements.length === 0}
                onClick={() => void execute()}
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
