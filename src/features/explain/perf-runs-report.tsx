import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { FileJsonIcon, SaveIcon } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PlanComparisonPanel } from "@/features/explain/plan-comparison-panel";
import { formatCapturedAt } from "@/lib/explain-file";
import {
  defaultPerfFileName,
  type PerfRun,
  parsePerfTestFile,
  perfRunAsSavedPlan,
  type SavedPerfTest,
  serializePerfTest,
  summarizeRuns,
} from "@/lib/perf-test";

const PERF_FILTERS = [{ name: "l8db-Performance-Test", extensions: ["json"] }];

interface PerfRunsReportProps {
  current: SavedPerfTest | null;
  running: boolean;
  fileBase: string;
  onError: (message: string | null) => void;
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

export function PerfRunsReport({ current, running, fileBase, onError }: PerfRunsReportProps) {
  const [loaded, setLoaded] = useState<{ fileName: string; saved: SavedPerfTest } | null>(null);
  const [leftId, setLeftId] = useState<string | null>(null);
  const [rightId, setRightId] = useState<string | null>(null);

  const summary = useMemo(() => (current ? summarizeRuns(current.runs) : null), [current]);

  const sources = useMemo<RunSource[]>(() => {
    const entries: RunSource[] = [];
    if (current) {
      for (const run of current.runs) {
        entries.push({
          id: `current-${run.index}`,
          label: `Aktueller Test · Lauf ${run.index}`,
          saved: current,
          run,
        });
      }
    }
    if (loaded) {
      for (const run of loaded.saved.runs) {
        entries.push({
          id: `loaded-${run.index}`,
          label: `${loaded.fileName} · Lauf ${run.index}`,
          saved: loaded.saved,
          run,
        });
      }
    }
    return entries;
  }, [current, loaded]);

  const left = sources.find((entry) => entry.id === leftId) ?? null;
  const right = sources.find((entry) => entry.id === rightId) ?? null;
  const fallbackLeft = left ?? sources[0] ?? null;
  const fallbackRight = right ?? sources.find((entry) => entry.id !== fallbackLeft?.id) ?? null;

  const handleSave = useCallback(async () => {
    if (!current) return;
    try {
      const path = await save({
        defaultPath: defaultPerfFileName({ table: fileBase, capturedAt: new Date() }),
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
  }, [current, fileBase]);

  const handleOpen = useCallback(async () => {
    try {
      const path = await open({ multiple: false, directory: false, filters: PERF_FILTERS });
      if (typeof path !== "string") return;
      const text = await readTextFile(path);
      const saved = parsePerfTestFile(text);
      setLoaded({ fileName: fileNameOf(path), saved });
      onError(null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [onError]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
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
      </div>

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
              {summary.rows ? ` · Zeilen median ${formatCount(summary.rows.median)}` : ""}
            </p>
          )}
        </div>
      )}

      {sources.length > 1 && (
        <div className="flex flex-col gap-3 rounded-lg border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold">Zwei Läufe vergleichen</span>
            <Select value={fallbackLeft?.id ?? ""} onValueChange={(value) => setLeftId(value)}>
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
            <Select value={fallbackRight?.id ?? ""} onValueChange={(value) => setRightId(value)}>
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
          {fallbackLeft && fallbackRight ? (
            <PlanComparisonPanel
              left={perfRunAsSavedPlan(fallbackLeft.saved, fallbackLeft.run)}
              right={perfRunAsSavedPlan(fallbackRight.saved, fallbackRight.run)}
              leftLabel={fallbackLeft.label}
              rightLabel={fallbackRight.label}
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
