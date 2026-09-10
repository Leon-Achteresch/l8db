import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import {
  AlertTriangleIcon,
  FileJsonIcon,
  PlayIcon,
  SaveIcon,
  SquareIcon,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlanComparisonPanel } from "@/features/explain/plan-comparison-panel";
import { useActiveConnection } from "@/lib/connections";
import { explainQuery } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { formatCapturedAt } from "@/lib/explain-file";
import {
  buildPerfTestSql,
  buildSavedPerfTest,
  defaultPerfFileName,
  normalizeRepeats,
  parsePerfTestFile,
  PERF_ANALYZE_HINT,
  PERF_DEFAULT_LIMIT,
  PERF_DEFAULT_REPEATS,
  PERF_MAX_REPEATS,
  PERF_MIN_REPEATS,
  type PerfRun,
  perfRunAsSavedPlan,
  type PerfTestDefinition,
  runMetricsFromPlan,
  type SavedPerfTest,
  serializePerfTest,
  summarizeRuns,
} from "@/lib/perf-test";
import { effectiveConnectionString } from "@/lib/ssh";

const PERF_FILTERS = [{ name: "l8db-Performance-Test", extensions: ["json"] }];

interface TablePerfPanelProps {
  schema: string;
  table: string;
  filter: string;
  isView: boolean;
}

interface RunSource {
  id: string;
  label: string;
  saved: SavedPerfTest;
  run: PerfRun;
}

function fileNameOf(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function formatMs(value: number | null): string {
  if (value === null) return "—";
  return `${value.toFixed(2)} ms`;
}

function formatCount(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString("de-DE");
}

export function TablePerfPanel({ schema, table, filter, isView }: TablePerfPanelProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();

  const [whereClause, setWhereClause] = useState(filter);
  const [orderBy, setOrderBy] = useState("");
  const [limit, setLimit] = useState(String(PERF_DEFAULT_LIMIT));
  const [repeats, setRepeats] = useState(String(PERF_DEFAULT_REPEATS));
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<SavedPerfTest | null>(null);
  const [loaded, setLoaded] = useState<{ fileName: string; saved: SavedPerfTest } | null>(null);
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);
  const cancelRef = useRef(false);

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

  const summary = useMemo(
    () => (current ? summarizeRuns(current.runs) : null),
    [current],
  );

  const sources = useMemo<RunSource[]>(() => {
    const entries: RunSource[] = [];
    for (const run of current?.runs ?? []) {
      entries.push({
        id: `current-${run.index}`,
        label: `Aktueller Test · Lauf ${run.index}`,
        saved: current as SavedPerfTest,
        run,
      });
    }
    for (const run of loaded?.saved.runs ?? []) {
      entries.push({
        id: `loaded-${run.index}`,
        label: `${loaded?.fileName ?? "Datei"} · Lauf ${run.index}`,
        saved: loaded!.saved,
        run,
      });
    }
    return entries;
  }, [current, loaded]);

  const left = sources.find((entry) => entry.id === leftId) ?? null;
  const right = sources.find((entry) => entry.id === rightId) ?? null;

  const handleRun = useCallback(async () => {
    if (!connection || running) return;
    cancelRef.current = false;
    setRunning(true);
    setError(null);
    setProgress({ done: 0, total: definition.repeats });
    const runs: PerfRun[] = [];
    const capturedAt = new Date();
    try {
      const connectionString = effectiveConnectionString(connection);
      for (let index = 1; index <= definition.repeats; index += 1) {
        if (cancelRef.current) break;
        const startedAt = new Date();
        const started = performance.now();
        const plans = await explainQuery(
          connection.kind,
          connectionString,
          sql,
          definition.analyze,
          database ?? undefined,
        );
        const wall = performance.now() - started;
        const root = plans[0] as Record<string, unknown> | undefined;
        const node = plans[0]?.Plan;
        if (!node) throw new Error("Kein Ausführungsplan erhalten.");
        runs.push({
          index,
          startedAt: startedAt.toISOString(),
          metrics: runMetricsFromPlan(node, wall, root),
          plan: node,
        });
        setProgress({ done: runs.length, total: definition.repeats });
      }
      if (runs.length === 0) {
        setCurrent(null);
        setError(cancelRef.current ? "Test abgebrochen. Es wurde kein Lauf gewertet." : null);
        return;
      }
      const saved = buildSavedPerfTest(definition, runs, sql, {
        connectionName: connection.name,
        databaseKind: connection.kind,
        database,
        capturedAt,
      });
      setCurrent(saved);
      setLeftId(runs.length > 1 ? `current-${runs[0].index}` : null);
      setRightId(runs.length > 1 ? `current-${runs[runs.length - 1].index}` : null);
      if (cancelRef.current) {
        toast.info(`Test abgebrochen. ${runs.length} von ${definition.repeats} Läufen gemessen.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      cancelRef.current = false;
      setRunning(false);
      setProgress(null);
    }
  }, [connection, running, definition, sql, database]);

  const handleSave = useCallback(async () => {
    if (!current) return;
    try {
      const path = await save({
        defaultPath: defaultPerfFileName({ table, capturedAt: new Date() }),
        filters: PERF_FILTERS,
      });
      if (!path) return;
      await writeTextFile(path, serializePerfTest(current));
      toast.success("Performance-Test gespeichert.");
    } catch (err) {
      toast.error(
        `Test konnte nicht gespeichert werden: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [current, table]);

  const handleOpen = useCallback(async () => {
    try {
      const path = await open({ multiple: false, directory: false, filters: PERF_FILTERS });
      if (typeof path !== "string") return;
      const text = await readTextFile(path);
      const saved = parsePerfTestFile(text);
      setLoaded({ fileName: fileNameOf(path), saved });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

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
            disabled={running}
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
            disabled={running}
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
              disabled={running}
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
              disabled={running}
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
            onClick={() => void handleRun()}
            disabled={running || !connection}
          >
            <PlayIcon className="size-3.5" />
            {isView ? "View testen" : "Tabelle testen"}
          </Button>
          {running && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1.5 px-2.5 text-xs"
              onClick={() => {
                cancelRef.current = true;
              }}
            >
              <SquareIcon className="size-3.5" />
              Abbrechen
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={() => void handleSave()}
            disabled={!current || running}
          >
            <SaveIcon className="size-3.5" />
            Läufe speichern…
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2.5 text-xs"
            onClick={() => void handleOpen()}
            disabled={running}
          >
            <FileJsonIcon className="size-3.5" />
            Gespeicherte Läufe öffnen…
          </Button>
          {progress && (
            <span className="text-xs text-muted-foreground">
              Lauf {Math.min(progress.done + 1, progress.total)} von {progress.total}…
            </span>
          )}
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {current && (
        <div className="rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <span className="text-xs font-semibold">Läufe</span>
            <span className="text-xs text-muted-foreground">
              {formatCapturedAt(current.capturedAt)}
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th className="px-3 py-1.5 text-left font-medium">Lauf</th>
                  <th className="px-3 py-1.5 text-right font-medium">Laufzeit</th>
                  <th className="px-3 py-1.5 text-right font-medium">Planung</th>
                  <th className="px-3 py-1.5 text-right font-medium">Zeilen</th>
                  <th className="px-3 py-1.5 text-right font-medium">Buffer hit</th>
                  <th className="px-3 py-1.5 text-right font-medium">Buffer read</th>
                  <th className="px-3 py-1.5 text-right font-medium">Kosten</th>
                  <th className="px-3 py-1.5 text-right font-medium">Knoten</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {current.runs.map((run) => (
                  <tr key={run.index} className="border-b last:border-b-0">
                    <td className="px-3 py-1.5">{run.index}</td>
                    <td className="px-3 py-1.5 text-right">{formatMs(run.metrics.durationMs)}</td>
                    <td className="px-3 py-1.5 text-right">{formatMs(run.metrics.planTimeMs)}</td>
                    <td className="px-3 py-1.5 text-right">{formatCount(run.metrics.rows)}</td>
                    <td className="px-3 py-1.5 text-right">
                      {formatCount(run.metrics.sharedHitBlocks)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {formatCount(run.metrics.sharedReadBlocks)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {run.metrics.totalCost === null ? "—" : run.metrics.totalCost.toFixed(2)}
                    </td>
                    <td className="px-3 py-1.5 text-right">{run.metrics.nodeCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {summary?.duration && (
            <p className="border-t px-3 py-2 text-xs text-muted-foreground">
              Laufzeit min {formatMs(summary.duration.min)} · median{" "}
              {formatMs(summary.duration.median)} · max {formatMs(summary.duration.max)} · ø{" "}
              {formatMs(summary.duration.avg)}
              {summary.rows
                ? ` · Zeilen median ${formatCount(summary.rows.median)}`
                : ""}
            </p>
          )}
        </div>
      )}

      {sources.length > 1 && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold">Zwei Läufe vergleichen</span>
            <Select value={leftId ?? ""} onValueChange={(value) => setLeftId(value)}>
              <SelectTrigger size="sm" className="h-7 w-64 text-xs">
                <SelectValue placeholder="Lauf A wählen" />
              </SelectTrigger>
              <SelectContent>
                {sources.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id} className="text-xs">
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={rightId ?? ""} onValueChange={(value) => setRightId(value)}>
              <SelectTrigger size="sm" className="h-7 w-64 text-xs">
                <SelectValue placeholder="Lauf B wählen" />
              </SelectTrigger>
              <SelectContent>
                {sources.map((entry) => (
                  <SelectItem key={entry.id} value={entry.id} className="text-xs">
                    {entry.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {left && right ? (
            <PlanComparisonPanel
              left={perfRunAsSavedPlan(left.saved, left.run)}
              right={perfRunAsSavedPlan(right.saved, right.run)}
              leftLabel={left.label}
              rightLabel={right.label}
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Zwei Läufe auswählen, um Kennzahlen und Planknoten zu vergleichen.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
