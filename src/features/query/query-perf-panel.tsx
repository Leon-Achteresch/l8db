import { AlertTriangleIcon, GaugeIcon, PlayIcon, SquareIcon, XIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PerfRunsReport } from "@/features/explain/perf-runs-report";
import { usePerfRunner } from "@/lib/hooks/use-perf-runner";
import {
  isReadOnlyStatement,
  normalizeRepeats,
  PERF_ANALYZE_HINT,
  PERF_DEFAULT_REPEATS,
  PERF_MAX_REPEATS,
  PERF_MIN_REPEATS,
  stripSqlNoise,
} from "@/lib/perf-test";

interface QueryPerfPanelProps {
  sql: string;
  onClose: () => void;
}

export function QueryPerfPanel({ sql, onClose }: QueryPerfPanelProps) {
  const runner = usePerfRunner();
  const [repeats, setRepeats] = useState(String(PERF_DEFAULT_REPEATS));

  const statement = useMemo(() => stripSqlNoise(sql), [sql]);
  const readOnly = useMemo(() => isReadOnlyStatement(statement), [statement]);
  const runCount = normalizeRepeats(Number.parseInt(repeats, 10));

  return (
    <div className="flex max-h-[60%] shrink-0 flex-col gap-3 overflow-y-auto border-b bg-muted/20 p-3">
      <div className="flex items-center gap-2">
        <GaugeIcon className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold">Performance-Test der aktuellen Abfrage</span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto size-6 p-0"
          onClick={onClose}
          title="Schließen"
        >
          <XIcon className="size-3.5" />
        </Button>
      </div>

      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
        <p className="flex items-start gap-2 text-xs">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          <span>{PERF_ANALYZE_HINT}</span>
        </p>
      </div>

      {!readOnly && statement.length > 0 && (
        <p className="text-xs text-destructive">
          Nur eine einzelne lesende Abfrage (SELECT/WITH) kann gemessen werden, damit der Test keine
          Daten verändert.
        </p>
      )}

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor="query-perf-repeats">
            Wiederholungen
          </Label>
          <Input
            id="query-perf-repeats"
            type="number"
            min={PERF_MIN_REPEATS}
            max={PERF_MAX_REPEATS}
            value={repeats}
            onChange={(event) => setRepeats(event.target.value)}
            className="h-8 w-28 text-xs"
            disabled={runner.running}
          />
        </div>
        <Button
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs"
          onClick={() =>
            void runner.start({
              sql: statement,
              repeats: runCount,
              analyze: true,
              definition: null,
            })
          }
          disabled={runner.running || !runner.canRun || !readOnly}
        >
          <PlayIcon className="size-3.5" />
          Abfrage testen
        </Button>
        {runner.running && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={runner.cancel}
          >
            <SquareIcon className="size-3.5" />
            Abbrechen
          </Button>
        )}
        {runner.progress && (
          <span className="text-xs text-muted-foreground">
            Lauf {Math.min(runner.progress.done + 1, runner.progress.total)} von{" "}
            {runner.progress.total}…
          </span>
        )}
      </div>

      {runner.current && runner.current.sql !== statement && (
        <p className="text-xs text-muted-foreground">
          Gemessene Abfrage weicht vom aktuellen Editorinhalt ab:{" "}
          <span className="font-mono">{runner.current.sql}</span>
        </p>
      )}

      {runner.error && <p className="text-xs text-destructive">{runner.error}</p>}

      <PerfRunsReport
        current={runner.current}
        running={runner.running}
        fileBase="query"
        onError={runner.setError}
      />
    </div>
  );
}
