import { useCallback, useEffect, useMemo, useState } from "react";

import { useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import {
  CheckIcon,
  CodeIcon,
  CopyIcon,
  PlayIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  TableIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

import { QueryEditorPane } from "@/components/query/QueryEditorPane";
import { DataTable } from "@/components/table/data-table";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useActiveConnection } from "@/lib/connections";
import {
  listAllColumns,
  listTables,
  updateViewDefinition,
} from "@/lib/db";
import { useActiveDatabase } from "@/lib/db-selection";
import {
  PAGE_SIZE,
  useForeignKeysQuery,
  useSchemasQuery,
  useTableRowCountQuery,
  useTableRowsQuery,
  useViewDefinitionQuery,
} from "@/lib/queries";
import { useTableTabs } from "@/lib/table-tabs";

interface ViewEditorPageProps {
  schema: string;
  view: string;
}

export function ViewEditorPage({ schema, view }: ViewEditorPageProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openTab = useTableTabs((state) => state.openTab);
  const { data: foreignKeys } = useForeignKeysQuery(schema, view);

  const [activeTab, setActiveTab] = useState<"data" | "definition">("data");
  const [filter, setFilter] = useState("");
  const [sorting, setSorting] = useState<SortingState>([]);
  const [page, setPage] = useState(0);

  const { data, isLoading, isFetching, isError, error } = useTableRowsQuery(
    schema,
    view,
    filter,
    sorting,
    true,
    page,
  );
  const { data: totalCount } = useTableRowCountQuery(schema, view, filter);

  const { data: definition, isLoading: defLoading } = useViewDefinitionQuery(
    schema,
    view,
  );

  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [compileStatus, setCompileStatus] = useState<"idle" | "ok" | "error">(
    "idle",
  );
  const [compileError, setCompileError] = useState<string | null>(null);

  const currentValue = draft ?? definition ?? "";
  const isDirty = draft !== null && draft !== definition;

  useEffect(() => {
    setDraft(null);
    setCompileStatus("idle");
    setCompileError(null);
  }, [schema, view, definition]);

  useEffect(() => {
    setFilter("");
    setSorting([]);
    setPage(0);
    setActiveTab("data");
  }, [schema, view]);

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

  const handleFilterChange = (newFilter: string) => {
    setFilter(newFilter);
    setPage(0);
  };

  const handleNavigateToTable = useMemo(() => {
    return (targetSchema: string, targetTable: string, filterWhere?: string) => {
      openTab({ schema: targetSchema, table: targetTable, entityType: "table" });
      void navigate({
        to: "/tables/$schema/$table",
        params: { schema: targetSchema, table: targetTable },
        search: filterWhere ? { fkFilter: filterWhere } : {},
      });
    };
  }, [openTab, navigate]);

  const handleChange = useCallback((value: string) => {
    setDraft(value);
    setCompileStatus("idle");
    setCompileError(null);
  }, []);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(currentValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleReset = () => {
    setDraft(null);
    setCompileStatus("idle");
    setCompileError(null);
  };

  const handleCompile = useCallback(async () => {
    if (!connection) return;
    setBusy(true);
    setCompileError(null);
    try {
      await updateViewDefinition(
        connection.kind,
        connection.connectionString,
        schema,
        view,
        currentValue,
        true,
        database ?? undefined,
      );
      setCompileStatus("ok");
      toast.success("View-Definition ist valide.");
    } catch (e) {
      setCompileStatus("error");
      setCompileError(String(e));
      toast.error("Kompilierungsfehler.");
    } finally {
      setBusy(false);
    }
  }, [connection, schema, view, currentValue, database]);

  const handleExecute = useCallback(async () => {
    if (!connection) return;
    setBusy(true);
    try {
      await updateViewDefinition(
        connection.kind,
        connection.connectionString,
        schema,
        view,
        currentValue,
        false,
        database ?? undefined,
      );
      toast.success("View-Definition aktualisiert.");
      setDraft(null);
      setCompileStatus("idle");
      setCompileError(null);
      await queryClient.invalidateQueries({ queryKey: ["view-definition"] });
      await queryClient.invalidateQueries({ queryKey: ["rows"] });
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }, [connection, schema, view, currentValue, database, queryClient]);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">
          Keine Verbindung aktiv.
        </p>
      </div>
    );
  }

  const emptyMessage =
    filter.trim() === "" ? "Keine Daten." : "Keine Zeilen für diesen Filter.";

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as "data" | "definition")}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center border-b bg-muted/30 px-3">
        <TabsList variant="line" className="h-9">
          <TabsTrigger value="data">
            <TableIcon className="size-3.5" />
            Daten
          </TabsTrigger>
          <TabsTrigger value="definition">
            <CodeIcon className="size-3.5" />
            Definition
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent
        value="data"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {isLoading ? (
          <ViewDataSkeleton />
        ) : isError ? (
          <ViewDataError error={error} />
        ) : (
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            <DataTable
              className="h-full min-h-0 flex-1"
              columns={data?.columns ?? []}
              data={data?.rows ?? []}
              emptyMessage={emptyMessage}
              sorting={sorting}
              onSortingChange={setSorting}
              isFetching={isFetching}
              onApplyFilter={handleFilterChange}
              page={page}
              totalCount={totalCount ?? undefined}
              pageSize={PAGE_SIZE}
              onPageChange={setPage}
              foreignKeys={foreignKeys}
              currentSchema={schema}
              currentTable={view}
              onNavigateToTable={handleNavigateToTable}
            />
          </div>
        )}
      </TabsContent>

      <TabsContent
        value="definition"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {defLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Spinner />
              Lade Definition...
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-2 border-b px-3">
              <Button
                size="sm"
                variant="default"
                className="h-7 gap-1.5 px-3 text-xs"
                onClick={handleExecute}
                disabled={busy || !isDirty}
              >
                {busy ? (
                  <Spinner className="size-3" />
                ) : (
                  <PlayIcon className="size-3" />
                )}
                Ausführen
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 px-3 text-xs"
                onClick={handleCompile}
                disabled={busy || !isDirty}
              >
                <ShieldCheckIcon className="size-3" />
                Kompilieren
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 px-3 text-xs"
                onClick={handleCopy}
              >
                {copied ? (
                  <CheckIcon className="size-3" />
                ) : (
                  <CopyIcon className="size-3" />
                )}
                Kopieren
              </Button>
              {isDirty && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1.5 px-3 text-xs"
                  onClick={handleReset}
                  disabled={busy}
                >
                  <RotateCcwIcon className="size-3" />
                  Zurücksetzen
                </Button>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {schema}.{view}
              </span>
            </div>

            <div className="min-h-0 flex-1">
              <QueryEditorPane
                value={currentValue}
                onChange={handleChange}
                onRun={handleExecute}
                registry={registry}
              />
            </div>

            {compileError && (
              <div className="shrink-0 border-t border-destructive/20 bg-destructive/5 px-3 py-2 text-xs font-mono text-destructive select-text">
                {compileError}
              </div>
            )}
            {compileStatus === "ok" && (
              <div className="shrink-0 border-t border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                Validierung erfolgreich.
              </div>
            )}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}

function ViewDataSkeleton() {
  return (
    <div className="flex-1 overflow-hidden border-t border-border bg-background p-4 space-y-3 select-none">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-24 bg-muted/50" />
        <Skeleton className="h-8 w-32 bg-muted/50" />
        <Skeleton className="h-8 w-20 bg-muted/50" />
        <Skeleton className="h-8 w-40 bg-muted/50" />
      </div>
      <div className="space-y-3 mt-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="flex gap-3 items-center">
            <Skeleton className="h-5 w-8 rounded-sm bg-muted/30" />
            <Skeleton className="h-5 flex-1 rounded-sm bg-muted/30" />
            <Skeleton className="h-5 flex-1 rounded-sm bg-muted/30" />
            <Skeleton className="h-5 flex-1 rounded-sm bg-muted/30" />
            <Skeleton className="h-5 flex-1 rounded-sm bg-muted/30" />
          </div>
        ))}
      </div>
    </div>
  );
}

function ViewDataError({ error }: { error: unknown }) {
  return (
    <div className="flex flex-1 items-center justify-center p-6 border-t border-border bg-background">
      <div className="flex flex-col items-center gap-3 max-w-md text-center p-6 rounded-lg border border-destructive/20 bg-destructive/5 shadow-xs">
        <TriangleAlertIcon className="size-8 text-destructive animate-bounce" />
        <h3 className="text-sm font-semibold text-destructive">
          Fehler beim Laden der View
        </h3>
        <p className="text-xs text-muted-foreground font-mono bg-destructive/[0.02] p-2.5 rounded border border-destructive/10 break-all select-text">
          {String(error)}
        </p>
      </div>
    </div>
  );
}
