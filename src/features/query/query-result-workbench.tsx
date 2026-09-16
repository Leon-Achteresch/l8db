import { type ReactNode, useDeferredValue, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { copyText } from "@/lib/clipboard";
import type { DatabaseKind, QueryResult } from "@/lib/db";
import { COPY_FORMATS, type CopyFormat, serializeRows } from "@/lib/export";
import { gridCellText } from "@/lib/grid-search";
import { useQueryWorkspace } from "@/lib/query-workspace";
import { cn } from "@/lib/utils";
import { QueryCellInspector } from "./query-cell-inspector";
import { QueryResultTable } from "./query-result-table";

export function QueryResultWorkbench({
  result,
  isLoading,
  error,
  kind,
  statusText,
  actions,
}: {
  result: QueryResult | null;
  isLoading: boolean;
  error: string | null;
  kind?: DatabaseKind;
  statusText?: string | null;
  actions?: ReactNode;
}) {
  const workspace = useQueryWorkspace();
  const [search, setSearch] = useState("");
  const [cell, setCell] = useState<{ column: string; value: unknown; row: number } | null>(null);
  const [lastResult, setLastResult] = useState(result);
  if (lastResult !== result) {
    setLastResult(result);
    setSearch("");
    setCell(null);
  }
  const term = useDeferredValue(search).trim().toLocaleLowerCase();
  const filtered = useMemo(
    () =>
      !result || !term
        ? result
        : {
            ...result,
            rows: result.rows.filter((row) =>
              result.columns.some((column) =>
                gridCellText(row[column] ?? "NULL")
                  .toLocaleLowerCase()
                  .includes(term),
              ),
            ),
          },
    [result, term],
  );
  const jsonRows = useMemo(
    () =>
      workspace.resultView === "json"
        ? (filtered?.rows ?? []).map((row) =>
            JSON.stringify(row, null, 2)
              .split("\n")
              .map((line) => `  ${line}`)
              .join("\n"),
          )
        : [],
    [filtered, workspace.resultView],
  );
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
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5">
        <span className="font-medium text-xs">Ergebnisse</span>
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
        <Input
          className="h-7 w-48 text-xs"
          aria-label="Ergebnisse durchsuchen"
          placeholder="Ergebnisse durchsuchen…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {workspace.resultView === "json" && (
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {filtered?.rows.length} / {result.rows.length} Zeilen
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            className="h-7 text-xs"
            variant={workspace.resultView === "table" ? "secondary" : "ghost"}
            aria-pressed={workspace.resultView === "table"}
            onClick={() => workspace.update({ resultView: "table" })}
          >
            Tabelle
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs"
            variant={workspace.resultView === "json" ? "secondary" : "ghost"}
            aria-pressed={workspace.resultView === "json"}
            onClick={() => workspace.update({ resultView: "json" })}
          >
            JSON
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                className="h-7 text-xs"
                variant="ghost"
                title="Suchergebnisse kopieren; lokale Spaltenfilter und Sortierung gelten nur in der Tabelle"
              >
                Kopieren
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {COPY_FORMATS.map((format) => (
                <DropdownMenuItem key={format.value} onSelect={() => void handleCopy(format.value)}>
                  Als {format.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {actions}
        </div>
      </div>
      {workspace.resultView === "json" ? (
        <pre
          className="min-h-0 flex-1 overflow-auto bg-muted/10 p-4 font-mono"
          style={{ fontSize: `${workspace.resultFontSize / 16}rem`, contain: "strict" }}
        >
          {"[\n"}
          {jsonRows.map((text, index) => (
            <div
              key={index}
              style={{ contentVisibility: "auto", containIntrinsicSize: "auto 200px" }}
            >
              {text}
              {index < jsonRows.length - 1 ? ",\n" : "\n"}
            </div>
          ))}
          {"]"}
        </pre>
      ) : (
        <div className="min-h-0 flex-1">
          <QueryResultTable
            result={filtered}
            isLoading={false}
            error={null}
            onInspect={(column, value, row) => setCell({ column, value, row })}
          />
        </div>
      )}
      <QueryCellInspector cell={cell} onClose={() => setCell(null)} />
    </div>
  );
}
