import { useNavigate } from "@tanstack/react-router";
import { PencilIcon, RefreshCw, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { IconButton } from "@/components/icon-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useSqlQuery } from "@/features/dashboard/use-dataset-query";
import { queryErrorMessage } from "@/lib/connection-url";
import { useActiveCapabilities } from "@/lib/db-selection";
import type { HomeWidget } from "@/lib/home-layout";
import { isReadOnlyFor } from "@/lib/perf-test/sql-noise";
import { useTableTabs } from "@/lib/table-tabs";
import { HomeQueryDialog } from "../home-query-dialog";

const ROW_LIMIT = 200;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function QueryWidget({
  widget,
  onChange,
}: {
  widget: HomeWidget;
  onChange: (patch: Partial<HomeWidget>) => void;
}) {
  const language = useActiveCapabilities().query_language;
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const sql = widget.sql?.trim() ?? "";
  const readOnly = sql !== "" && isReadOnlyFor(language, sql);
  const query = useSqlQuery(readOnly ? sql : "");
  const title = widget.title || "Abfrage";
  const columns = query.data?.columns ?? [];
  const rows = query.data?.rows ?? [];

  function openInEditor() {
    const id = useTableTabs.getState().openQueryTabWithSql(sql, widget.title || undefined);
    void navigate({ to: "/query/$id", params: { id } });
  }

  return (
    <section className="flex h-full flex-col overflow-hidden rounded-2xl border bg-card">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold" title={title}>
            {title}
          </h2>
          {query.data && (
            <p className="mt-0.5 text-[10px] text-muted-foreground">
              {rows.length > ROW_LIMIT
                ? `${ROW_LIMIT} von ${rows.length.toLocaleString("de-DE")} Zeilen`
                : `${rows.length.toLocaleString("de-DE")} Zeilen`}{" "}
              · {query.data.execution_time_ms} ms
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {readOnly && (
            <IconButton
              variant="ghost"
              size="icon-xs"
              aria-label="Abfrage neu ausführen"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw className={query.isFetching ? "animate-spin" : undefined} />
            </IconButton>
          )}
          {sql !== "" && (
            <IconButton
              variant="ghost"
              size="icon-xs"
              aria-label="Im SQL-Editor öffnen"
              onClick={openInEditor}
            >
              <SquareTerminal />
            </IconButton>
          )}
          <IconButton
            variant="ghost"
            size="icon-xs"
            aria-label="Abfrage bearbeiten"
            onClick={() => setEditing(true)}
          >
            <PencilIcon />
          </IconButton>
        </div>
      </div>
      {sql === "" ? (
        <div className="grid min-h-0 flex-1 place-items-center p-5 text-center">
          <div>
            <p className="text-xs text-muted-foreground">Noch keine Abfrage hinterlegt.</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setEditing(true)}>
              Abfrage festlegen
            </Button>
          </div>
        </div>
      ) : !readOnly ? (
        <p className="p-5 text-xs leading-relaxed text-muted-foreground">
          Diese Abfrage wird nicht automatisch ausgeführt. Auf der Startseite laufen nur einzelne
          lesende Abfragen, damit beim Öffnen keine Daten verändert werden.
        </p>
      ) : query.isPending ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-6 w-full" />
          ))}
        </div>
      ) : query.isError ? (
        <p role="alert" className="p-5 text-xs leading-relaxed text-destructive">
          {queryErrorMessage(query.error) || "Die Abfrage ist fehlgeschlagen."}
        </p>
      ) : rows.length === 0 ? (
        <div className="grid min-h-0 flex-1 place-items-center text-xs text-muted-foreground">
          Keine Zeilen
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-card">
              <tr className="text-left text-muted-foreground">
                {columns.map((column) => (
                  <th key={column} className="whitespace-nowrap border-b px-3 py-2 font-medium">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, ROW_LIMIT).map((row, index) => (
                <tr key={String(index)} className="border-b border-border/50 last:border-0">
                  {columns.map((column) => (
                    <td
                      key={column}
                      className={
                        row[column] === null || row[column] === undefined
                          ? "px-3 py-1.5 font-mono text-muted-foreground/60"
                          : "max-w-64 truncate px-3 py-1.5 font-mono"
                      }
                    >
                      {cellText(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <HomeQueryDialog widget={widget} onSave={onChange} onClose={() => setEditing(false)} />
      )}
    </section>
  );
}
