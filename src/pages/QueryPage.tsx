import { useCallback, useRef, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { PlayIcon, Trash2Icon } from "lucide-react";

import { QueryEditorPane } from "@/components/query/QueryEditorPane";
import { QueryResultTable } from "@/components/query/QueryResultTable";
import { Button } from "@/components/ui/button";
import { useActiveConnection } from "@/lib/connections";
import { executeQuery, listAllColumns, listTables, type QueryResult } from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useSchemasQuery } from "@/lib/queries";

export function QueryPage() {
  const connection = useActiveConnection();
  const database = useActiveDatabase();

  const [sql, setSql] = useState("SELECT * FROM ");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);

  const [editorHeight, setEditorHeight] = useState(280);
  const dragStartRef = useRef<{ y: number; h: number } | null>(null);

  const { data: schemas } = useSchemasQuery();

  const { data: tables } = useQuery({
    queryKey: ["all-tables", connection?.id, database],
    queryFn: () =>
      listTables(
        connection!.kind,
        connection!.connectionString,
        database ?? undefined,
      ),
    enabled: Boolean(connection),
  });

  const { data: columns } = useQuery({
    queryKey: ["all-columns", connection?.id, database],
    queryFn: () =>
      listAllColumns(
        connection!.kind,
        connection!.connectionString,
        database ?? undefined,
      ),
    enabled: Boolean(connection),
    staleTime: 60_000,
  });

  const registry = {
    schemas: schemas ?? [],
    tables: tables ?? [],
    columns: columns ?? [],
  };

  const handleRun = useCallback(async () => {
    if (!connection || !sql.trim()) return;
    setIsRunning(true);
    setError(null);
    try {
      const res = await executeQuery(
        connection.kind,
        connection.connectionString,
        sql,
        database ?? undefined,
      );
      setResult(res);
    } catch (err) {
      setError(String(err));
      setResult(null);
    } finally {
      setIsRunning(false);
    }
  }, [connection, sql, database]);

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragStartRef.current = { y: e.clientY, h: editorHeight };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      if (!dragStartRef.current) return;
      const delta = ev.clientY - dragStartRef.current.y;
      setEditorHeight(Math.max(80, Math.min(700, dragStartRef.current.h + delta)));
    };

    const onUp = () => {
      dragStartRef.current = null;
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const statusText = (() => {
    if (!result) return null;
    const parts: string[] = [];
    if (result.columns.length > 0) {
      parts.push(
        `${result.rows.length} Zeile${result.rows.length === 1 ? "" : "n"}`,
      );
    }
    if (result.rows_affected !== null && result.rows_affected !== undefined && result.columns.length === 0) {
      parts.push(
        `${result.rows_affected} betroffen`,
      );
    }
    parts.push(`${result.execution_time_ms} ms`);
    return parts.join(" · ");
  })();

  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <Button
          size="sm"
          variant="default"
          className="h-7 gap-1.5 px-3 text-xs"
          onClick={handleRun}
          disabled={isRunning || !connection}
        >
          <PlayIcon className="size-3" />
          Ausführen
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-3 text-xs"
          onClick={() => {
            setResult(null);
            setError(null);
            setSql("");
          }}
          disabled={isRunning}
        >
          <Trash2Icon className="size-3" />
          Leeren
        </Button>
        {!connection && (
          <span className="ml-2 text-xs text-muted-foreground">
            Keine Verbindung aktiv
          </span>
        )}
        {statusText && (
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {statusText}
          </span>
        )}
        {error && !statusText && (
          <span className="ml-auto text-xs text-destructive">Fehler</span>
        )}
      </div>

      <div
        style={{ height: editorHeight }}
        className="w-full min-w-0 shrink-0 overflow-hidden"
      >
        <QueryEditorPane
          value={sql}
          onChange={setSql}
          onRun={handleRun}
          registry={registry}
        />
      </div>

      <div
        role="separator"
        aria-orientation="horizontal"
        onPointerDown={handleDragStart}
        className="h-1 shrink-0 cursor-row-resize bg-transparent transition-colors hover:bg-border"
      />

      <div className="min-h-0 flex-1 border-t">
        <QueryResultTable result={result} isLoading={isRunning} error={error} />
      </div>
    </div>
  );
}
