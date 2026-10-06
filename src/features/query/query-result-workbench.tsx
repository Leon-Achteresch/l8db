import { useVirtualizer } from "@tanstack/react-virtual";
import { MoreHorizontal } from "lucide-react";
import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { CreateViewDialog, isViewableSelect } from "@/features/query/create-view-dialog";
import { ResultTitle } from "@/features/query/query-view/result-title";
import { copyText } from "@/lib/clipboard";
import { useConnectionsStore } from "@/lib/connections/store";
import type { DatabaseKind, QueryResult } from "@/lib/db";
import { COPY_FORMATS, type CopyFormat, serializeRows } from "@/lib/export";
import { gridCellText } from "@/lib/grid-search";
import { useCapabilities } from "@/lib/providers";
import { useQueryWorkspace } from "@/lib/query-workspace";
import { temporaryViewMode } from "@/lib/session-views";
import { cn } from "@/lib/utils";
import { QueryCellInspector } from "./query-cell-inspector";
import { useMaskedQueryResult } from "./query-result-masking";
import { QueryResultTable } from "./query-result-table";
import type { ResultChartBinding } from "./result-chart/types";

const ResultChartView = lazy(() =>
  import("./result-chart/result-chart-view").then((m) => ({ default: m.ResultChartView })),
);

export function QueryResultWorkbench({
  result,
  isLoading,
  error,
  kind,
  statusText,
  actions,
  chart,
}: {
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
  const jsonScrollRef = useRef<HTMLPreElement>(null);
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
  const visibleRows = filtered?.rows ?? [];
  const jsonVirtualizer = useVirtualizer({
    count: workspace.resultView === "json" && filtered ? visibleRows.length + 2 : 0,
    getScrollElement: () => jsonScrollRef.current,
    estimateSize: (index) =>
      (index === 0 || index === visibleRows.length + 1 ? 1 : (filtered?.columns.length ?? 0) + 3) *
      workspace.resultFontSize *
      1.5,
    overscan: 3,
    initialRect: { width: 700, height: 700 },
  });
  const handleCopy = async (format: CopyFormat) => {
    try {
      await copyText(serializeRows(result?.columns ?? [], filtered?.rows ?? [], format));
      toast.success("Suchergebnisse kopiert");
    } catch {
      toast.error("Ergebnisse konnten nicht kopiert werden");
    }
  };
  if (isLoading || error)
    return <QueryResultTable result={result} isLoading={isLoading} error={error} kind={kind} />;
  if (!result)
    return (
      <div className="flex h-full items-center justify-center bg-muted/10 p-8">
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" className="size-7" variant="ghost" aria-label="Ergebnisoptionen">
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={chartView ? "chart" : workspace.resultView}
                onValueChange={(value) =>
                  value === "chart" && chart
                    ? chart.onChange({ ...chart.state, view: "chart" })
                    : showGrid(value as "table" | "json")
                }
              >
                <DropdownMenuRadioItem value="table">Tabelle</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="json">JSON</DropdownMenuRadioItem>
                {chart && <DropdownMenuRadioItem value="chart">Diagramm</DropdownMenuRadioItem>}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger>Kopieren</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {COPY_FORMATS.map((format) => (
                    <DropdownMenuItem
                      key={format.value}
                      onSelect={() => void handleCopy(format.value)}
                    >
                      Als {format.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
              {canCreateView && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setViewDialogOpen(true)}>
                    Als View speichern…
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
        <pre
          ref={jsonScrollRef}
          className="min-h-0 flex-1 overflow-auto bg-muted/10 p-4 font-mono"
          style={{
            fontSize: `${workspace.resultFontSize / 16}rem`,
            lineHeight: 1.5,
            contain: "strict",
          }}
          data-slot="query-json-rows"
          tabIndex={-1}
        >
          <div className="relative" style={{ height: jsonVirtualizer.getTotalSize() }}>
            {jsonVirtualizer.getVirtualItems().map((virtualRow) => {
              const index = virtualRow.index;
              const row = visibleRows[index - 1];
              const text =
                index === 0
                  ? "[\n"
                  : index === visibleRows.length + 1
                    ? "]"
                    : `${JSON.stringify(row, null, 2)
                        .split("\n")
                        .map((line) => `  ${line}`)
                        .join("\n")}${index < visibleRows.length ? ",\n" : "\n"}`;
              return (
                <div
                  key={virtualRow.key}
                  data-index={index}
                  ref={jsonVirtualizer.measureElement}
                  className="absolute top-0 left-0"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  {text}
                </div>
              );
            })}
          </div>
        </pre>
      ) : (
        <div className="min-h-0 flex-1">
          <QueryResultTable
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
