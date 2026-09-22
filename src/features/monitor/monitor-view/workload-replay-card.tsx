import { FileJsonIcon, PlayIcon, RepeatIcon, SaveIcon, SquareIcon, XIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { firstLine } from "@/features/monitor/monitor-view/format";
import type { WorkloadReplayState } from "@/features/monitor/monitor-view/use-workload-replay";
import { WorkloadComparisonTable } from "@/features/monitor/monitor-view/workload-comparison-table";
import { WorkloadParams } from "@/features/monitor/monitor-view/workload-params";
import { WorkloadResultTable } from "@/features/monitor/monitor-view/workload-result-table";
import {
  isReadOnlyStatement,
  PERF_MAX_CONCURRENCY,
  PERF_MAX_REPEATS,
  stripSqlNoise,
} from "@/lib/perf-test";
import { supports } from "@/lib/providers";
import { detectPlaceholders, skipReason } from "@/lib/workload";

export function WorkloadReplayCard({ replay }: { replay: WorkloadReplayState }) {
  const { workload, target, result, baseline } = replay;
  const bindable = target ? supports(target, "bind_parameters") : false;
  const runnable = workload
    ? workload.statements.filter(
        (statement) => !skipReason(statement, target?.kind ?? "", bindable),
      ).length
    : 0;

  return (
    <Card size="sm">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2 text-sm">
          <RepeatIcon className="size-4 text-primary" />
          Workload abspielen
        </CardTitle>
        <CardDescription>
          Spielt gespeicherte Statements gegen eine Zielverbindung ab, z. B. alte gegen neue
          Version. Nur lesende Statements werden ausgeführt.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 text-xs"
            onClick={() => void replay.openWorkload()}
            disabled={replay.running}
          >
            <FileJsonIcon className="size-3.5" />
            Workload öffnen…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-xs"
            onClick={() => void replay.saveWorkload()}
            disabled={!workload || replay.running}
          >
            <SaveIcon className="size-3.5" />
            Workload speichern…
          </Button>
          {workload && (
            <span className="text-xs text-muted-foreground">
              {replay.workloadName ?? "Aus Top-Statements"} · {workload.statements.length}{" "}
              Statements aus {workload.connectionName || "unbekannter Quelle"}
            </span>
          )}
        </div>

        {!workload ? (
          <p className="rounded-md border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
            Statements oben auswählen und als Workload übernehmen oder eine Workload-Datei öffnen.
          </p>
        ) : (
          <ol className="max-h-72 divide-y overflow-auto rounded-md border">
            {workload.statements.map((statement, index) => {
              const placeholders = detectPlaceholders(statement.sql, workload.databaseKind);
              const reason = target ? skipReason(statement, target.kind, bindable) : null;
              return (
                <li key={`${index}-${statement.sql}`} className="px-3 py-2 text-xs">
                  <p className="truncate font-mono" title={statement.sql}>
                    {firstLine(statement.sql)}
                  </p>
                  {placeholders.length > 0 &&
                    bindable &&
                    isReadOnlyStatement(stripSqlNoise(statement.sql)) && (
                      <WorkloadParams
                        statementIndex={index}
                        placeholders={placeholders}
                        values={statement.params}
                        disabled={replay.running}
                        onChange={replay.updateParam}
                      />
                    )}
                  {reason && (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">{reason}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Zielverbindung</Label>
            <Select
              value={target?.id ?? ""}
              onValueChange={(value) => replay.setTargetId(value)}
              disabled={replay.running}
            >
              <SelectTrigger size="sm" className="h-8 w-64 text-xs" aria-label="Zielverbindung">
                <SelectValue placeholder="Verbindung wählen" />
              </SelectTrigger>
              <SelectContent searchable>
                {replay.connections.map((connection) => (
                  <SelectItem key={connection.id} value={connection.id} className="text-xs">
                    {connection.name} · {connection.kind}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs" htmlFor="workload-repeats">
              Läufe je Statement
            </Label>
            <Input
              id="workload-repeats"
              type="number"
              min={1}
              max={PERF_MAX_REPEATS}
              value={replay.repeats}
              onChange={(event) => replay.setRepeats(event.target.value)}
              className="h-8 w-24 text-xs"
              disabled={replay.running}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs" htmlFor="workload-concurrency">
              Parallel
            </Label>
            <Input
              id="workload-concurrency"
              type="number"
              min={1}
              max={PERF_MAX_CONCURRENCY}
              value={replay.concurrency}
              onChange={(event) => replay.setConcurrency(event.target.value)}
              className="h-8 w-24 text-xs"
              disabled={replay.running}
            />
          </div>
          <Button
            size="sm"
            className="h-8 gap-1.5 text-xs"
            onClick={() => void replay.run()}
            disabled={!workload || !target || replay.running || runnable === 0}
          >
            <PlayIcon className="size-3.5" />
            Abspielen
          </Button>
          {replay.running && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 text-xs"
              onClick={replay.cancel}
            >
              <SquareIcon className="size-3.5" />
              Abbrechen
            </Button>
          )}
          {replay.progress && workload && (
            <span className="text-xs text-muted-foreground">
              Statement {replay.progress.statement + 1} von {workload.statements.length} ·{" "}
              {replay.progress.done}/{replay.progress.total} Läufe
            </span>
          )}
        </div>

        {replay.error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2">
            <p className="min-w-0 flex-1 text-xs break-words text-destructive">{replay.error}</p>
            <Button
              size="sm"
              variant="ghost"
              className="h-5 px-1.5"
              onClick={() => replay.setError(null)}
              aria-label="Fehler ausblenden"
            >
              <XIcon className="size-3" />
            </Button>
          </div>
        )}

        {result && (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold">
                Ergebnis gegen {result.connectionName} · {result.repeats} Läufe ·{" "}
                {result.concurrency} parallel
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 text-xs"
                onClick={() => void replay.saveResult()}
              >
                <SaveIcon className="size-3.5" />
                Ergebnis speichern…
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={replay.takeResultAsBaseline}
              >
                Als Vergleichsbasis merken
              </Button>
            </div>
            <WorkloadResultTable result={result} />
          </div>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold">Vergleich</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 text-xs"
              onClick={() => void replay.openBaseline()}
              disabled={replay.running}
            >
              <FileJsonIcon className="size-3.5" />
              Ergebnis als Basis öffnen…
            </Button>
            {baseline && (
              <>
                <span className="text-xs text-muted-foreground">Basis: {baseline.fileName}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => replay.setBaseline(null)}
                >
                  Basis entfernen
                </Button>
              </>
            )}
          </div>
          {baseline && result ? (
            <WorkloadComparisonTable
              left={baseline.saved}
              right={result}
              leftLabel="A"
              rightLabel="B"
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Basis (A) festlegen und danach gegen eine andere Verbindung abspielen (B), um die
              Laufzeiten je Statement zu vergleichen.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
