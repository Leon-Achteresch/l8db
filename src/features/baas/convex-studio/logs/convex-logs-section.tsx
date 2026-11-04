import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { Copy, Download, Eraser, RefreshCw, ScrollText, SearchX } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { copyWithToast } from "@/lib/clipboard";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasEmptyState } from "../../baas-empty-state";
import { BaasSectionHeader } from "../../baas-section-header";
import type { ConvexStudioSectionProps } from "../convex-studio-sections";
import {
  bucketExecutions,
  buildLogRows,
  type ConvexExecution,
  DEFAULT_LOG_FILTERS,
  filterExecutions,
  LOG_BUFFER_LIMIT,
  type LogFilters,
  toJsonl,
} from "./convex-logs-buffer";
import { ConvexLogsChart } from "./convex-logs-chart";
import { ConvexLogsDetail } from "./convex-logs-detail";
import { ConvexLogsList } from "./convex-logs-list";
import { ConvexLogsToolbar } from "./convex-logs-toolbar";
import { useConvexLogStream } from "./use-convex-log-stream";

export function ConvexLogsSection({ deployment }: ConvexStudioSectionProps) {
  const feature = useNewFeatureVisibility<HTMLHeadingElement>("baas.convex.studio.logs");
  const [live, setLive] = useState(false);
  const [grouped, setGrouped] = useState(false);
  const [filters, setFilters] = useState<LogFilters>(DEFAULT_LOG_FILTERS);
  const [selected, setSelected] = useState<ConvexExecution | null>(null);
  const stream = useConvexLogStream(deployment, live);
  const deferredFilters = useDeferredValue(filters);
  const visible = useMemo(
    () => filterExecutions(stream.executions, deferredFilters),
    [stream.executions, deferredFilters],
  );
  const rows = useMemo(() => buildLogRows(visible, grouped), [visible, grouped]);
  const chart = useMemo(() => bucketExecutions(visible), [visible]);
  const identifiers = useMemo(
    () => [...new Set(stream.executions.map((execution) => execution.identifier))].sort(),
    [stream.executions],
  );
  const failures = visible.filter((execution) => execution.success === false).length;

  const exportJsonl = async () => {
    const path = await save({
      defaultPath: `convex-logs-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.jsonl`,
      filters: [{ name: "JSON Lines", extensions: ["jsonl"] }],
    });
    if (!path) return;
    try {
      await writeTextFile(path, `${toJsonl(visible, filters.levels)}\n`);
      toast.success(`${visible.length} Ausführungen exportiert.`);
    } catch (error) {
      toast.error(String(error));
    }
  };

  return (
    <div className="space-y-4">
      <BaasSectionHeader
        title="Logs"
        titleRef={feature.ref}
        isNew={feature.isNew}
        description={
          <>
            {visible.length} von {stream.executions.length} Ausführungen
            {failures > 0 && ` · ${failures} Fehler`} · Puffer max. {LOG_BUFFER_LIMIT}
            {stream.dropped > 0 && ` · ${stream.dropped} übersprungen`}
          </>
        }
        actions={
          <>
            <Label className="flex items-center gap-2 text-xs">
              <Switch checked={live} onCheckedChange={setLive} />
              Live
            </Label>
            <Label className="flex items-center gap-2 text-xs">
              <Switch checked={grouped} onCheckedChange={setGrouped} />
              Nach Request gruppieren
            </Label>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={live || stream.loading}
              onClick={() => void stream.refresh()}
            >
              <RefreshCw className={`size-3.5 ${stream.loading ? "animate-spin" : ""}`} />
              Aktualisieren
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={visible.length === 0}
              onClick={() => void copyWithToast(toJsonl(visible, filters.levels), "Logs")}
            >
              <Copy className="size-3.5" />
              Kopieren
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={visible.length === 0}
              onClick={() => void exportJsonl()}
            >
              <Download className="size-3.5" />
              JSONL
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              disabled={stream.executions.length === 0}
              onClick={stream.clear}
            >
              <Eraser className="size-3.5" />
              Leeren
            </Button>
          </>
        }
      />
      <ConvexLogsToolbar filters={filters} identifiers={identifiers} onChange={setFilters} />
      {stream.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {stream.error}
        </p>
      )}
      <ConvexLogsChart buckets={chart.buckets} size={chart.size} />
      {rows.length === 0 ? (
        <BaasEmptyState
          compact
          icon={stream.executions.length > 0 ? SearchX : ScrollText}
          title={
            stream.loading
              ? "Logs werden geladen …"
              : stream.executions.length === 0
                ? live
                  ? "Warte auf neue Funktionsaufrufe …"
                  : "Keine Logs im Puffer."
                : "Keine Logs passen zu den Filtern."
          }
          description={
            !stream.loading && stream.executions.length === 0 && !live
              ? "Live einschalten, um neue Aufrufe zu verfolgen."
              : undefined
          }
        />
      ) : (
        <ConvexLogsList rows={rows} levels={deferredFilters.levels} onSelect={setSelected} />
      )}
      <ConvexLogsDetail
        execution={selected}
        onClose={() => setSelected(null)}
        onRequest={(requestId) => {
          setSelected(null);
          setGrouped(true);
          setFilters({ ...DEFAULT_LOG_FILTERS, search: requestId });
        }}
      />
    </div>
  );
}
