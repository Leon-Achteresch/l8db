import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SortingState, Updater } from "@tanstack/react-table";
import { Download, FileJson, Filter, FilterX, Plus, Table2 } from "lucide-react";
import { useMemo, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import {
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DataTable } from "@/features/table/data-table";
import { TableDataError } from "@/features/table/table-data-error";
import { TableDataSkeleton } from "@/features/table/table-data-skeleton";
import { changedRowValues } from "@/lib/cell-editor";
import { copyWithToast } from "@/lib/clipboard";
import {
  type ConvexDataSchema,
  type ConvexDataTables,
  type ConvexDocument,
  type ConvexFilterExpression,
  convexDataDelete,
  convexDataDocuments,
  convexDataInsert,
  convexDataPatch,
} from "@/lib/db/convex-studio-data";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { BaasEmptyState } from "../../baas-empty-state";
import type { ConvexStudioDeployment } from "../convex-studio-sections";
import { ConvexDataConfirmDialog } from "./convex-data-confirm-dialog";
import { ConvexDataDocumentDialog } from "./convex-data-document-dialog";
import { ConvexDataFilterPanel } from "./convex-data-filter-panel";
import {
  activeFilterCount,
  compileFilter,
  dataKey,
  documentColumnDetails,
  documentColumns,
  documentRows,
  documentsText,
  EMPTY_FILTER,
  type FilterState,
  idReferences,
  PAGE_SIZE,
  parseEditedValue,
  saveDocuments,
  schemaFields,
} from "./convex-data-utils";

export function ConvexDataDocuments({
  deployment,
  table,
  schema,
  total,
  onOpenDocument,
  onOpenReference,
}: {
  deployment: ConvexStudioDeployment;
  table: string;
  schema: ConvexDataSchema | undefined;
  total: number | null | undefined;
  onOpenDocument: (document: ConvexDocument) => void;
  onOpenReference: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const feature = useNewFeatureVisibility<HTMLDivElement>("baas.convex.studio.data.grid");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [offsets, setOffsets] = useState([0]);
  const [dialog, setDialog] = useState<{ mode: "insert" } | { mode: "patch"; id: string } | null>(
    null,
  );
  const [deleting, setDeleting] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const indexes = schema?.indexes ?? [];
  const schemaTable = schema?.tables.find((item) => item.tableName === table);
  const fields = schemaFields(schemaTable);

  let expression: ConvexFilterExpression | null = null;
  let filterError: string | null = null;
  try {
    expression = compileFilter(filter, indexes, table, order);
  } catch (cause) {
    filterError = cause instanceof Error ? cause.message : String(cause);
  }
  const cursor = cursors[cursors.length - 1];
  const documents = useQuery({
    queryKey: [...dataKey(deployment), "documents", table, expression, cursor],
    queryFn: () => convexDataDocuments(deployment, table, expression, cursor, PAGE_SIZE),
    enabled: filterError === null,
    placeholderData: keepPreviousData,
  });
  const page = useMemo(() => documents.data?.documents ?? [], [documents.data]);
  const columns = useMemo(() => documentColumns(page, schemaTable), [page, schemaTable]);
  const filtered = activeFilterCount(filter) > 0;
  const searching = filter.mode === "search";
  const pageIndex = cursors.length - 1;
  const offset = offsets.at(-1) ?? 0;
  const rows = useMemo(() => documentRows(page), [page]);
  const sorting = useMemo<SortingState>(
    () => (searching ? [] : [{ id: "_creationTime", desc: order === "desc" }]),
    [searching, order],
  );
  const columnDetails = useMemo(
    () => documentColumnDetails(columns, table, fields),
    [columns, table, fields],
  );
  const documentById = (id: unknown) => page.find((item) => item._id === id);

  function reset() {
    setCursors([null]);
    setOffsets([0]);
  }

  function changeSorting(updater: Updater<SortingState>) {
    const next = typeof updater === "function" ? updater(sorting) : updater;
    const entry = next.find((item) => item.id === "_creationTime");
    setOrder(entry && !entry.desc ? "asc" : "desc");
    reset();
  }

  function changePage(next: number) {
    if (next < pageIndex) {
      setCursors((value) => value.slice(0, Math.max(1, next + 1)));
      setOffsets((value) => value.slice(0, Math.max(1, next + 1)));
      return;
    }
    if (documents.isFetching || documents.isPlaceholderData) return;
    const nextCursor = documents.data?.cursor ?? null;
    if (next !== pageIndex + 1 || !documents.data?.has_more || !nextCursor) return;
    setCursors((value) => [...value, nextCursor]);
    setOffsets((value) => [...value, offset + page.length]);
  }

  async function refresh(delta = 0) {
    if (delta)
      queryClient.setQueryData<ConvexDataTables>([...dataKey(deployment), "tables"], (data) =>
        data
          ? {
              ...data,
              tables: data.tables.map((item) =>
                item.name === table && item.documents !== null
                  ? { ...item, documents: Math.max(0, item.documents + delta) }
                  : item,
              ),
            }
          : data,
      );
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [...dataKey(deployment), "documents", table] }),
      queryClient.invalidateQueries({ queryKey: [...dataKey(deployment), "infer", table] }),
    ]);
  }

  async function saveRow(
    id: string,
    updates: Record<string, string | null>,
    oldValues: Record<string, unknown>,
  ) {
    const original = documentById(id) ?? oldValues;
    const changed = changedRowValues(updates, oldValues).updates;
    const patch = Object.fromEntries(
      Object.entries(changed).map(([field, text]) => [
        field,
        parseEditedValue(text, original[field], fields?.[field]?.fieldType),
      ]),
    );
    if (Object.keys(patch).length === 0) return;
    await convexDataPatch(deployment, table, [id], patch);
    await refresh();
  }

  async function exportPage(format: "json" | "jsonl", target: "copy" | "save") {
    setMessage(null);
    try {
      if (target === "copy") {
        await copyWithToast(documentsText(page, format), format.toUpperCase());
      } else if (await saveDocuments(table, format, page)) {
        setMessage("Export gespeichert.");
      }
    } catch (cause) {
      setMessage(String(cause));
    }
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={feature.ref}
        className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1.5"
      >
        <Button
          variant={filtered ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={showFilters}
          onClick={() => setShowFilters((value) => !value)}
        >
          <Filter className="size-3.5" /> Filter
          {filtered ? ` (${activeFilterCount(filter)})` : ""}
        </Button>
        <Button size="sm" onClick={() => setDialog({ mode: "insert" })}>
          <Plus className="size-3.5" /> Dokument
        </Button>
        {feature.isNew && <NewBadge />}
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" disabled={page.length === 0}>
                <Download className="size-3.5" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void exportPage("json", "copy")}>
                Seite als JSON kopieren
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportPage("jsonl", "copy")}>
                Seite als JSONL kopieren
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void exportPage("json", "save")}>
                Seite als JSON speichern…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportPage("jsonl", "save")}>
                Seite als JSONL speichern…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {showFilters && (
        <div className="shrink-0 border-b bg-muted/20 px-3 py-2">
          <ConvexDataFilterPanel
            key={JSON.stringify(filter)}
            table={table}
            columns={columns}
            indexes={indexes}
            initial={filter}
            error={filterError}
            onApply={(next) => {
              setFilter(next);
              reset();
            }}
          />
        </div>
      )}
      {((!showFilters && filterError) || message) && (
        <div className="shrink-0 space-y-0.5 border-b bg-muted/20 px-3 py-1.5 text-xs">
          {!showFilters && filterError && (
            <p role="alert" className="text-destructive">
              {filterError}
            </p>
          )}
          {message && (
            <p role="status" className="text-muted-foreground">
              {message}
            </p>
          )}
        </div>
      )}
      {documents.isError ? (
        <TableDataError
          title="Dokumente konnten nicht geladen werden"
          error={documents.error}
          onRetry={() => void documents.refetch()}
        />
      ) : documents.isPending && filterError === null ? (
        <TableDataSkeleton />
      ) : page.length === 0 && pageIndex === 0 && filterError === null ? (
        filtered ? (
          <BaasEmptyState
            icon={FilterX}
            title="Keine passenden Dokumente."
            description="Kein Dokument erfüllt die aktiven Filter. Passe die Bedingungen an oder setze sie zurück."
          >
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFilter(EMPTY_FILTER);
                reset();
              }}
            >
              <FilterX className="size-3.5" /> Filter zurücksetzen
            </Button>
          </BaasEmptyState>
        ) : (
          <BaasEmptyState
            icon={Table2}
            title="Die Tabelle ist leer."
            description={
              <>
                Füge Dokumente als JSON ein oder importiere eine Datei über die Tabellenaktionen.
                Mutations deiner App schreiben ebenfalls hierher.
              </>
            }
          >
            <Button size="sm" onClick={() => setDialog({ mode: "insert" })}>
              <Plus className="size-3.5" /> Dokument einfügen
            </Button>
          </BaasEmptyState>
        )
      ) : (
        <DataTable
          key={`${deployment.profileId}:${deployment.deploymentName}:${table}`}
          stateKey={`convex:${deployment.profileId}:${deployment.deploymentName}:${table}`}
          scrollIdentity={JSON.stringify([expression, cursor])}
          className="h-full min-h-0 flex-1"
          columns={columns}
          data={rows}
          emptyMessage="Keine Dokumente auf dieser Seite."
          sorting={sorting}
          sortableColumns={searching ? [] : ["_creationTime"]}
          onSortingChange={changeSorting}
          isFetching={documents.isFetching}
          onSaveRow={saveRow}
          canEditCell={(_, column) => !column.startsWith("_")}
          page={pageIndex}
          pageSize={PAGE_SIZE}
          rowOffset={offset}
          countLabel={
            !filtered && typeof total === "number"
              ? total.toLocaleString("de-DE")
              : documents.data?.has_more
                ? "mehr"
                : (offset + page.length).toLocaleString("de-DE")
          }
          hasNextPage={Boolean(documents.data?.has_more)}
          onPageChange={changePage}
          onDeleteRow={(id) => setDeleting(id)}
          onRefresh={() => refresh()}
          columnDetails={columnDetails}
          rowMenuItems={(row) => {
            const document = documentById(row.__ctid__);
            if (!document) return null;
            const references = idReferences(document);
            return (
              <>
                <ContextMenuItem onSelect={() => onOpenDocument(document)}>
                  <FileJson className="size-3.5" /> Dokument öffnen
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => setDialog({ mode: "patch", id: document._id })}>
                  Felder setzen…
                </ContextMenuItem>
                {references.length > 0 && (
                  <ContextMenuSub>
                    <ContextMenuSubTrigger>Referenz öffnen</ContextMenuSubTrigger>
                    <ContextMenuSubContent className="max-h-80 overflow-y-auto">
                      {references.map((reference) => (
                        <ContextMenuItem
                          key={reference.path}
                          className="font-mono"
                          onSelect={() => onOpenReference(reference.id)}
                        >
                          {reference.path}
                        </ContextMenuItem>
                      ))}
                    </ContextMenuSubContent>
                  </ContextMenuSub>
                )}
                <ContextMenuSeparator />
              </>
            );
          }}
        />
      )}
      {dialog && (
        <ConvexDataDocumentDialog
          mode={dialog.mode}
          table={table}
          count={1}
          initial={dialog.mode === "insert" ? "{\n  \n}" : "{}"}
          onOpenChange={(open) => !open && setDialog(null)}
          onSubmit={async (items) => {
            if (dialog.mode === "insert") {
              const inserted = await convexDataInsert(deployment, table, items);
              setMessage(`${inserted} Dokumente eingefügt.`);
              await refresh(inserted);
              return;
            }
            await convexDataPatch(deployment, table, [dialog.id], items[0]);
            setMessage("Dokument aktualisiert.");
            await refresh();
          }}
        />
      )}
      <ConvexDataConfirmDialog
        open={deleting !== null}
        title="Dokument löschen?"
        description={`Das Dokument ${deleting ?? ""} wird endgültig aus ${table} gelöscht.`}
        action="Löschen"
        onOpenChange={(open) => !open && setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          const deleted = await convexDataDelete(deployment, table, [deleting]);
          setMessage(`${deleted} Dokumente gelöscht.`);
          await refresh(-deleted);
        }}
      />
    </div>
  );
}
