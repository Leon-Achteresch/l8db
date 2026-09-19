import { Check, Copy } from "lucide";
import {
  CodeIcon,
  Columns2Icon,
  NetworkIcon,
  PlayIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  TableIcon,
} from "lucide-react";
import { MorphIcon } from "morphicons/react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { OpenInQueryEditorButton } from "@/features/functions/use-sql-object-edit";
import { QueryEditorPane } from "@/features/query/query-editor-pane";
import { DataTable } from "@/features/table/data-table";
import { TableColumnsList } from "@/features/table/table-columns-list";
import { TableDataError } from "@/features/table/table-data-error";
import { TableDataSkeleton } from "@/features/table/table-data-skeleton";
import { TableFilterPanel } from "@/features/table/table-filter-panel";
import { TableUsedByPanel } from "@/features/table/table-used-by-panel";
import { TableViewsPanel } from "@/features/table/table-views-panel";
import { tableColumnPrefKey, useTableColumnPrefs } from "@/lib/table-column-prefs";
import { useTableViewStateStore } from "@/lib/table-view-state";
import { useViewEditor } from "./view-editor-view/use-view-editor";

interface ViewEditorViewProps {
  schema: string;
  view: string;
}

export function ViewEditorView({ schema, view }: ViewEditorViewProps) {
  const {
    activeTab,
    busy,
    capabilities,
    columnDetails,
    compileError,
    compileStatus,
    connection,
    copied,
    currentValue,
    data,
    database,
    ddl,
    defLoading,
    error,
    filter,
    filterRaw,
    foreignKeys,
    handleChange,
    handleCompile,
    handleCopy,
    handleExecute,
    handleFilterChange,
    handleNavigateToTable,
    handleReset,
    isDirty,
    isError,
    isFetching,
    isLoading,
    page,
    refetch,
    registry,
    rowLimit,
    setActiveTab,
    setPage,
    setSorting,
    sorting,
    stateKey,
    totalCount,
  } = useViewEditor(schema, view);

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">Keine Verbindung aktiv.</p>
      </div>
    );
  }

  const emptyMessage = filter.trim() === "" ? "Keine Daten." : "Keine Zeilen für diesen Filter.";

  return (
    <Tabs
      value={activeTab}
      onValueChange={(v) => setActiveTab(v as "data" | "columns" | "definition" | "used-by")}
      className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
    >
      <div className="flex shrink-0 items-center border-b bg-muted/30 px-3">
        <TabsList variant="line" className="h-9">
          <TabsTrigger value="data">
            <TableIcon className="size-3.5" />
            Daten
          </TabsTrigger>
          <TabsTrigger value="columns">
            <Columns2Icon className="size-3.5" />
            Columns
          </TabsTrigger>
          <TabsTrigger value="definition">
            <CodeIcon className="size-3.5" />
            Definition
          </TabsTrigger>
          {capabilities.used_by && (
            <TabsTrigger value="used-by">
              <NetworkIcon className="size-3.5" />
              Used By
            </TabsTrigger>
          )}
        </TabsList>
      </div>

      <TabsContent value="data" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {isLoading ? (
          <TableDataSkeleton />
        ) : isError ? (
          <TableDataError
            title="Fehler beim Laden der View"
            error={error}
            onRetry={() => void refetch()}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
            <TableViewsPanel
              schema={schema}
              table={view}
              activeFilter={filter}
              filterRaw={filterRaw}
              onSelectView={(nextFilter, raw, saved) => {
                handleFilterChange(nextFilter, raw);
                if (saved?.state?.sorting) setSorting(saved.state.sorting);
                if (stateKey && saved?.state)
                  useTableViewStateStore.getState().patch(stateKey, {
                    ...saved.state,
                    filter: nextFilter,
                    filterRaw: raw ?? false,
                    page: 0,
                  });
                if (connection && saved?.layout)
                  useTableColumnPrefs
                    .getState()
                    .setPref(
                      tableColumnPrefKey(connection.id, schema, view, database),
                      saved.layout,
                    );
              }}
            />
            <div className="flex min-h-0 max-h-[min(28rem,55%)] shrink-0 flex-col overflow-hidden">
              <TableFilterPanel
                key={stateKey}
                stateKey={stateKey}
                columns={data?.columns ?? []}
                columnDetails={columnDetails}
                activeFilter={filter}
                onApply={handleFilterChange}
              />
            </div>
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
              pageSize={rowLimit}
              onPageChange={setPage}
              foreignKeys={foreignKeys}
              currentSchema={schema}
              currentTable={view}
              onNavigateToTable={handleNavigateToTable}
            />
          </div>
        )}
      </TabsContent>

      <TabsContent value="columns" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableColumnsList schema={schema} table={view} />
      </TabsContent>

      <TabsContent value="definition" className="flex min-h-0 flex-1 flex-col overflow-hidden">
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
                {busy ? <Spinner className="size-3" /> : <PlayIcon className="size-3" />}
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
                <MorphIcon icon={copied ? Check : Copy} className="size-3" />
                Kopieren
              </Button>
              <OpenInQueryEditorButton sql={ddl} title={`${schema}.${view}`} />
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

      <TabsContent value="used-by" className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <TableUsedByPanel schema={schema} name={view} />
      </TabsContent>
    </Tabs>
  );
}
