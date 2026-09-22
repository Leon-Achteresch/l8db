import { useMemo, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PerfModeHint } from "@/features/explain/perf-mode-hint";
import { PerfRunControls, type PerfRunSettings } from "@/features/explain/perf-run-controls";
import { PerfRunsReport } from "@/features/explain/perf-runs-report";
import { useActiveConnection } from "@/lib/connections";
import { useActiveCapabilities } from "@/lib/db-selection";
import { usePerfRunner } from "@/lib/hooks/use-perf-runner";
import {
  buildPerfTestSql,
  isReadOnlyFor,
  normalizeConcurrency,
  normalizeRepeats,
  PERF_DEFAULT_CONCURRENCY,
  PERF_DEFAULT_LIMIT,
  PERF_DEFAULT_REPEATS,
  type PerfTestDefinition,
  readOnlyRequirement,
} from "@/lib/perf-test";

interface TablePerfPanelProps {
  schema: string;
  table: string;
  filter: string;
  isView: boolean;
}

function planPrefix(kind: string | undefined, timed: boolean): string {
  if (timed || kind === "clickhouse") return "";
  return "EXPLAIN (ANALYZE, BUFFERS) ";
}

export function TablePerfPanel({ schema, table, filter, isView }: TablePerfPanelProps) {
  const connection = useActiveConnection();
  const language = useActiveCapabilities().query_language;
  const runner = usePerfRunner();
  const mongo = language === "json";

  const [whereClause, setWhereClause] = useState(filter);
  const [orderBy, setOrderBy] = useState("");
  const [limit, setLimit] = useState(String(PERF_DEFAULT_LIMIT));
  const [settings, setSettings] = useState<PerfRunSettings>({
    repeats: String(PERF_DEFAULT_REPEATS),
    concurrency: String(PERF_DEFAULT_CONCURRENCY),
    timed: false,
  });
  const timed = settings.timed || !runner.canExplain;

  const definition = useMemo<PerfTestDefinition>(() => {
    const parsedLimit = Number.parseInt(limit, 10);
    return {
      schema,
      table,
      filter: whereClause.trim().length > 0 ? whereClause.trim() : null,
      orderBy: orderBy.trim().length > 0 ? orderBy.trim() : null,
      limit: Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : null,
      repeats: normalizeRepeats(Number.parseInt(settings.repeats, 10)),
      concurrency: normalizeConcurrency(Number.parseInt(settings.concurrency, 10)),
      analyze: true,
      timed,
    };
  }, [schema, table, whereClause, orderBy, limit, settings, timed]);

  const sql = useMemo(
    () => buildPerfTestSql(definition, connection?.kind),
    [definition, connection?.kind],
  );
  const readOnly = useMemo(() => isReadOnlyFor(language, sql), [language, sql]);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
      <PerfModeHint timed={timed} />

      <div className="grid gap-3 rounded-lg border bg-card p-3 md:grid-cols-2">
        <div className="flex flex-col gap-1 md:col-span-2">
          <Label className="text-xs" htmlFor="perf-filter">
            {mongo ? "Filter (JSON)" : "Filter (WHERE)"}
          </Label>
          <Input
            id="perf-filter"
            value={whereClause}
            onChange={(event) => setWhereClause(event.target.value)}
            placeholder={mongo ? 'z. B. {"status": "aktiv"}' : "z. B. status = 'aktiv'"}
            className="h-8 font-mono text-xs"
            disabled={runner.running}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor="perf-order">
            {mongo ? "Sortierung (JSON)" : "Sortierung (ORDER BY)"}
          </Label>
          <Input
            id="perf-order"
            value={orderBy}
            onChange={(event) => setOrderBy(event.target.value)}
            placeholder={mongo ? 'z. B. {"_id": -1}' : "z. B. id DESC"}
            className="h-8 font-mono text-xs"
            disabled={runner.running}
          />
        </div>
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
            className="h-8 w-28 text-xs"
            disabled={runner.running}
          />
        </div>
        <pre className="overflow-x-auto rounded-md bg-muted/50 px-3 py-2 font-mono text-[11px] md:col-span-2">
          {`${planPrefix(connection?.kind, timed)}${sql}`}
        </pre>
        {!readOnly && (
          <p className="text-xs text-destructive md:col-span-2">{readOnlyRequirement(language)}</p>
        )}
        <div className="md:col-span-2">
          <PerfRunControls
            idPrefix="perf"
            runner={runner}
            settings={settings}
            onSettingsChange={setSettings}
            startLabel={isView ? "View testen" : "Tabelle testen"}
            startDisabled={!readOnly}
            onStart={() =>
              void runner.start({
                sql,
                repeats: definition.repeats,
                concurrency: definition.concurrency,
                analyze: definition.analyze,
                timed,
                definition,
              })
            }
          />
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
