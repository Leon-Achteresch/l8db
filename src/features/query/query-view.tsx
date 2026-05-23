import { useCallback, useRef, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { BookmarkIcon, DownloadIcon, LoaderIcon, PlayIcon, Trash2Icon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { QueryEditorPane } from "@/features/query/query-editor-pane";
import { QueryResultTable } from "@/features/query/query-result-table";
import { SaveQueryDialog } from "@/features/query/save-query-dialog";
import { Button } from "@/components/ui/button";
import { useActiveConnection } from "@/lib/connections";
import {
  beginTransaction,
  executeInTransaction,
  executeQuery,
  listAllColumns,
  listTables,
  type QueryResult,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import { useSchemasQuery } from "@/lib/queries";
import { useSavedQueriesStore } from "@/lib/saved-queries";
import { useTableTabs } from "@/lib/table-tabs";
import {
  getTransactionForConnection,
  useTransactionStore,
} from "@/lib/transactions";

const DML_PATTERN =
  /^(INSERT|UPDATE|DELETE|ALTER|DROP|CREATE|TRUNCATE|GRANT|REVOKE)\b/i;

interface QueryViewProps {
  tabId: string;
}

export function QueryView({ tabId }: QueryViewProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();

  const sql = useTableTabs((state) => {
    const tab = state.tabs.find((t) => t.kind === "query" && t.id === tabId);
    return tab?.kind === "query" ? tab.sql : "";
  });
  const updateQuerySql = useTableTabs((state) => state.updateQuerySql);

  const saveQuery = useSavedQueriesStore((state) => state.saveQuery);
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);

  const [result, setResult] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [exporting, setExporting] = useState(false);

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
      const store = useTransactionStore.getState();
      const existingTx = getTransactionForConnection(connection.id);
      const isDml = DML_PATTERN.test(sql.trim());

      if (existingTx) {
        const res = await executeInTransaction(existingTx.txId, sql);
        if (isDml) {
          store.addChange(existingTx.txId, {
            id: crypto.randomUUID(),
            type: "query",
            timestamp: Date.now(),
            sql,
            rowsAffected: res.rows_affected,
          });
          store.setPanelOpen(true);
        }
        setResult(res);
      } else if (isDml) {
        const txId = await beginTransaction(
          connection.kind,
          connection.connectionString,
          database ?? undefined,
        );
        store.addTransaction({
          txId,
          connectionId: connection.id,
          connectionName: connection.name,
          database: database ?? undefined,
          changes: [],
          startedAt: Date.now(),
        });
        const res = await executeInTransaction(txId, sql);
        store.addChange(txId, {
          id: crypto.randomUUID(),
          type: "query",
          timestamp: Date.now(),
          sql,
          rowsAffected: res.rows_affected,
        });
        store.setPanelOpen(true);
        setResult(res);
      } else {
        const res = await executeQuery(
          connection.kind,
          connection.connectionString,
          sql,
          database ?? undefined,
        );
        setResult(res);
      }
    } catch (err) {
      setError(String(err));
      setResult(null);
    } finally {
      setIsRunning(false);
    }
  }, [connection, sql, database]);

  const handleExport = async (format: "csv" | "json") => {
    if (!result || result.columns.length === 0) return;
    setExporting(true);
    try {
      const ext = format === "csv" ? "csv" : "json";
      const filePath = await save({
        defaultPath: `query-result.${ext}`,
        filters: [{ name: format.toUpperCase(), extensions: [ext] }],
      });
      if (!filePath) return;

      let content: string;
      if (format === "csv") {
        const header = result.columns.map((c) => JSON.stringify(c)).join(",");
        const rows = result.rows.map((row) =>
          result.columns
            .map((c) => {
              const v = row[c];
              if (v === null || v === undefined) return "";
              return `"${v.replace(/"/g, '""')}"`;
            })
            .join(","),
        );
        content = [header, ...rows].join("\n");
      } else {
        content = JSON.stringify(result.rows, null, 2);
      }
      await writeTextFile(filePath, content);
    } catch {
    } finally {
      setExporting(false);
    }
  };

  const handleDragStart = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragStartRef.current = { y: e.clientY, h: editorHeight };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      if (!dragStartRef.current) return;
      const delta = ev.clientY - dragStartRef.current.y;
      setEditorHeight(
        Math.max(80, Math.min(700, dragStartRef.current.h + delta)),
      );
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
    if (
      result.rows_affected !== null &&
      result.rows_affected !== undefined &&
      result.columns.length === 0
    ) {
      parts.push(`${result.rows_affected} betroffen`);
    }
    parts.push(`${result.execution_time_ms} ms`);
    return parts.join(" · ");
  })();

  return (
    <div className="flex h-full w-full flex-col">
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
          onClick={() => setSaveDialogOpen(true)}
          disabled={!sql.trim()}
        >
          <BookmarkIcon className="size-3" />
          Speichern
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-3 text-xs"
          onClick={() => {
            setResult(null);
            setError(null);
            updateQuerySql(tabId, "");
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
        {result && result.columns.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 px-3 text-xs"
                disabled={exporting}
              >
                {exporting ? (
                  <LoaderIcon className="size-3 animate-spin" />
                ) : (
                  <DownloadIcon className="size-3" />
                )}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void handleExport("csv")}>
                Als CSV exportieren
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void handleExport("json")}>
                Als JSON exportieren
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {error && !statusText && (
          <span className="ml-auto text-xs text-destructive">Fehler</span>
        )}
      </div>

      <div style={{ height: editorHeight }} className="shrink-0 overflow-hidden">
        <QueryEditorPane
          value={sql}
          onChange={(v) => updateQuerySql(tabId, v)}
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

      <SaveQueryDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        onSave={(name) => saveQuery(name, sql)}
      />
    </div>
  );
}
