import {
  BracesIcon,
  ChartColumnIcon,
  CopyIcon,
  EyeIcon,
  FileSpreadsheetIcon,
  HashIcon,
  MoreHorizontal,
  SheetIcon,
  TableIcon,
} from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useDeferredValue,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import {
  IconMenu,
  IconMenuContent,
  IconMenuItem,
  IconMenuRadioItem,
  IconMenuSeparator,
  IconMenuSubContent,
  IconMenuSubTrigger,
} from "@/components/icon-menu";
import { Cobweb } from "@/components/seasonal/cobweb";
import { Button } from "@/components/ui/button";
import {
  DropdownMenuRadioGroup,
  DropdownMenuSub,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { CreateViewDialog, isViewableSelect } from "@/features/query/create-view-dialog";
import { ResultTitle } from "@/features/query/query-view/result-title";
import { afterPaint } from "@/lib/after-paint";
import { copyText } from "@/lib/clipboard";
import { useConnectionsStore } from "@/lib/connections/store";
import type { DatabaseKind, QueryResult } from "@/lib/db";
import { COPY_FORMATS, type CopyFormat, serializeRows } from "@/lib/export";
import { gridCellText } from "@/lib/grid-search";
import { useCapabilities } from "@/lib/providers";
import { useQueryWorkspace } from "@/lib/query-workspace";
import { temporaryViewMode } from "@/lib/session-views";
import { cn } from "@/lib/utils";
import { showCopiedMessage } from "@/lib/workspace-status";
import { QueryCellInspector } from "./query-cell-inspector";
import { QueryJsonRows } from "./query-json-rows";
import { useMaskedQueryResult } from "./query-result-masking";
import { QueryResultTable } from "./query-result-table";
import type { ResultChartBinding } from "./result-chart/types";

const COPY_FORMAT_ICONS: Record<CopyFormat, typeof CopyIcon> = {
  json: BracesIcon,
  csv: FileSpreadsheetIcon,
  tsv: SheetIcon,
  markdown: HashIcon,
};

const ResultChartView = lazy(() =>
  import("./result-chart/result-chart-view").then((m) => ({ default: m.ResultChartView })),
);

export function QueryResultWorkbench({
  stateKey,
  result,
  isLoading,
  error,
  kind,
  statusText,
  actions,
  chart,
}: {
  stateKey?: string;
  result: QueryResult | null;
  isLoading: boolean;
  error: string | null;
  kind?: DatabaseKind;
  statusText?: string | null;
  actions?: ReactNode;
  chart?: ResultChartBinding;
}) {
  const workspace = useQueryWorkspace();
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [cell, setCell] = useState<{ column: string; value: unknown; row: number } | null>(null);
  const [viewDialogOpen, setViewDialogOpen] = useState(false);
  const viewConnection = useConnectionsStore((s) =>
    s.connections.find((c) => c.id === chart?.connectionId),
  );
  const viewsSupported = useCapabilities(kind).views || temporaryViewMode(kind) !== null;
  const canCreateView =
    viewsSupported &&
    Boolean(chart?.sqlCapable && viewConnection && !viewConnection.readOnly) &&
    isViewableSelect(chart?.sql ?? "");
  const inspectCell = useCallback(
    (column: string, value: unknown, row: number) => setCell({ column, value, row }),
    [],
  );
  const [lastResult, setLastResult] = useState(result);
  if (lastResult !== result) {
    setLastResult(result);
    setSearch("");
    setSearchOpen(false);
    setCell(null);
  }
  const { masked } = useMaskedQueryResult(result);
  const term = useDeferredValue(search).trim().toLowerCase();
  const filtered = useMemo(
    () =>
      !masked || !term
        ? masked
        : {
            ...masked,
            rows: masked.rows.filter((row) =>
              masked.columns.some((column) =>
                gridCellText(row[column] ?? "NULL")
                  .toLowerCase()
                  .includes(term),
              ),
            ),
          },
    [masked, term],
  );
  const handleCopy = async (format: CopyFormat) => {
    try {
      await copyText(serializeRows(result?.columns ?? [], filtered?.rows ?? [], format));
      showCopiedMessage("Suchergebnisse kopiert");
    } catch {
      toast.error("Ergebnisse konnten nicht kopiert werden");
    }
  };
  if (isLoading || error)
    return <QueryResultTable result={result} isLoading={isLoading} error={error} kind={kind} />;
  if (!result)
    return (
      <div className="relative flex h-full items-center justify-center bg-muted/10 p-8">
        <Cobweb className="size-24 text-foreground/20" />
        <div className="max-w-sm space-y-3 text-center">
          <div className="mx-auto flex size-10 items-center justify-center rounded-lg border bg-background font-mono text-lg text-muted-foreground">
            ↳
          </div>
          <p className="text-sm font-medium">Bereit für deine nächste Abfrage</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            SQL schreiben, einen Bereich markieren oder ein einzelnes Statement ausführen.
            Ergebnisse und Meldungen erscheinen hier.
          </p>
        </div>
      </div>
    );
  if (!result.columns.length)
    return <QueryResultTable result={result} isLoading={false} error={null} />;
  const chartView = chart?.state.view === "chart";
  const showGrid = (view: "table" | "json") => {
    workspace.update({ resultView: view });
    if (chart && chartView) chart.onChange({ ...chart.state, view: "grid" });
  };
  return (
    <div
      className="flex h-full min-h-0 flex-col"
      onKeyDownCapture={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
          e.preventDefault();
          e.stopPropagation();
          setSearchOpen(true);
        }
      }}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <ResultTitle />
        <span
          role="status"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-md border px-1.5 py-0.5 text-[10px]",
            isLoading
              ? "border-primary/30 bg-primary/10 text-primary"
              : error
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
          )}
        >
          <span className={cn("size-1.5 rounded-full bg-current", isLoading && "animate-pulse")} />
          {isLoading ? "Wird ausgeführt" : error ? "Fehlgeschlagen" : "Abgeschlossen"}
        </span>
        {statusText && (
          <span className="min-w-0 truncate text-[10px] tabular-nums text-muted-foreground">
            {statusText}
          </span>
        )}
        {searchOpen && (
          <Input
            autoFocus
            className="h-7 w-48 text-xs"
            aria-label="Ergebnisse durchsuchen"
            placeholder="Ergebnisse durchsuchen…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              setSearch("");
              setSearchOpen(false);
            }}
          />
        )}
        {!chartView && workspace.resultView === "json" && term && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {filtered?.rows.length} / {result.rows.length} Zeilen
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <IconMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button size="icon" className="size-7" variant="ghost" aria-label="Ergebnisoptionen">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <IconMenuContent>
              <DropdownMenuRadioGroup
                value={chartView ? "chart" : workspace.resultView}
                onValueChange={(value) =>
                  afterPaint(() =>
                    value === "chart" && chart
                      ? chart.onChange({ ...chart.state, view: "chart" })
                      : showGrid(value as "table" | "json"),
                  )
                }
              >
                <IconMenuRadioItem icon={<TableIcon />} label="Tabelle" value="table" />
                <IconMenuRadioItem icon={<BracesIcon />} label="JSON" value="json" />
                {chart && (
                  <IconMenuRadioItem icon={<ChartColumnIcon />} label="Diagramm" value="chart" />
                )}
              </DropdownMenuRadioGroup>
              <IconMenuSeparator />
              <DropdownMenuSub>
                <IconMenuSubTrigger icon={<CopyIcon />} label="Kopieren" />
                <IconMenuSubContent>
                  {COPY_FORMATS.map((format) => {
                    const Icon = COPY_FORMAT_ICONS[format.value];
                    return (
                      <IconMenuItem
                        key={format.value}
                        icon={<Icon />}
                        label={`Als ${format.label}`}
                        onSelect={() => void handleCopy(format.value)}
                      />
                    );
                  })}
                </IconMenuSubContent>
              </DropdownMenuSub>
              {canCreateView && (
                <>
                  <IconMenuSeparator />
                  <IconMenuItem
                    icon={<EyeIcon />}
                    label="Als View speichern…"
                    onSelect={() => setViewDialogOpen(true)}
                  />
                </>
              )}
            </IconMenuContent>
          </IconMenu>
          {chart && viewConnection && (
            <CreateViewDialog
              open={viewDialogOpen}
              onOpenChange={setViewDialogOpen}
              sql={chart.sql}
              connection={viewConnection}
              database={chart.database}
            />
          )}
          {actions}
        </div>
      </div>
      {chart && chartView ? (
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <ResultChartView
              columns={result.columns}
              rows={masked?.rows ?? result.rows}
              binding={chart}
            />
          </Suspense>
        </div>
      ) : workspace.resultView === "json" ? (
        <QueryJsonRows
          rows={filtered?.rows}
          columnCount={filtered?.columns.length ?? 0}
          fontSize={workspace.resultFontSize}
        />
      ) : (
        <div className="min-h-0 flex-1">
          <QueryResultTable
            stateKey={stateKey}
            result={filtered}
            isLoading={false}
            error={null}
            masked
            onInspect={inspectCell}
          />
        </div>
      )}
      <QueryCellInspector
        cell={cell}
        onClose={() => setCell(null)}
        getColumnValues={(column) => filtered?.rows.map((row) => row[column]) ?? []}
      />
    </div>
  );
}
