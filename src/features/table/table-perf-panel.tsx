import { AlertTriangleIcon, PlayIcon, SquareIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PerfRunsReport } from "@/features/explain/perf-runs-report";
import { useActiveConnection } from "@/lib/connections";
import { usePerfRunner } from "@/lib/hooks/use-perf-runner";
import {
  buildPerfTestSql,
  normalizeRepeats,
  PERF_ANALYZE_HINT,
  PERF_DEFAULT_LIMIT,
  PERF_DEFAULT_REPEATS,
  PERF_MAX_REPEATS,
  PERF_MIN_REPEATS,
  type PerfTestDefinition,
} from "@/lib/perf-test";

interface TablePerfPanelProps {
  schema: string;
  table: string;
  filter: string;
  isView: boolean;
}

export function TablePerfPanel({ schema, table, filter, isView }: TablePerfPanelProps) {
  const connection = useActiveConnection();
  const runner = usePerfRunner();

  const [whereClause, setWhereClause] = useState(filter);
  const [orderBy, setOrderBy] = useState("");
  const [limit, setLimit] = useState(String(PERF_DEFAULT_LIMIT));
  const [repeats, setRepeats] = useState(String(PERF_DEFAULT_REPEATS));

  const definition = useMemo<PerfTestDefinition>(() => {
    const parsedLimit = Number.parseInt(limit, 10);
    return {
      schema,
      table,
      filter: whereClause.trim().length > 0 ? whereClause.trim() : null,
      orderBy: orderBy.trim().length > 0 ? orderBy.trim() : null,
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null,
      repeats: normalizeRepeats(Number.parseInt(repeats, 10)),
      analyze: true,
    };
  }, [schema, table, whereClause, orderBy, limit, repeats]);

  const sql = useMemo(
    () => buildPerfTestSql(definition, connection?.kind),
    [definition, connection?.kind],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
        <p className="flex items-start gap-2 text-xs">
          <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0 text-amber-600" />
          <span>{PERF_ANALYZE_HINT}</span>
        </p>
      </div>

      <div className="grid gap-3 rounded-lg border bg-card p-3 md:grid-cols-2">
        <div className="flex flex-col gap-1 md:col-span-2">
          <Label className="text-xs" htmlFor="perf-filter">
            Filter (WHERE)
          </Label>
          <Input
            id="perf-filter"
            value={whereClause}
            onChange={(event) => setWhereClause(event.target.value)}
            placeholder="z. B. status = 'aktiv'"
            className="h-8 font-mono text-xs"
            disabled={runner.running}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor="perf-order">
            Sortierung (ORDER BY)
          </Label>
          <Input
            id="perf-order"
            value={orderBy}
            onChange={(event) => setOrderBy(event.target.value)}
            placeholder="z. B. id DESC"
            className="h-8 font-mono text-xs"
            disabled={runner.running}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs" htmlFor="perf-limit">
              Limit
            </Label>
            <Input
              id="perf-limit"
              type="number"
              min={1}
              value={limit}
              onChange={(event) => setLimit(event.target.value)}
              className="h-8 text-xs"
              disabled={runner.running}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs" htmlFor="perf-repeats">
              Wiederholungen
            </Label>
            <Input
              id="perf-repeats"
              type="number"
              min={PERF_MIN_REPEATS}
              max={PERF_MAX_REPEATS}
              value={repeats}
              onChange={(event) => setRepeats(event.target.value)}
              className="h-8 text-xs"
              disabled={runner.running}
            />
          </div>
        </div>
        <pre className="overflow-x-auto rounded-md bg-muted/50 px-3 py-2 font-mono text-[11px] md:col-span-2">
          {`EXPLAIN (ANALYZE, BUFFERS) ${sql}`}
        </pre>
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <Button
            size="sm"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={() =>
              void runner.start({
                sql,
                repeats: definition.repeats,
                analyze: definition.analyze,
                definition,
              })
            }
            disabled={runner.running || !runner.canRun}
          >
            <PlayIcon className="size-3.5" />
            {isView ? "View testen" : "Tabelle testen"}
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
      </div>

      {runner.error && <p className="text-xs text-destructive">{runner.error}</p>}

      <PerfRunsReport
        current={runner.current}
        running={runner.running}
        fileBase={table}
        onError={runner.setError}
      />
    </div>
  );
}
