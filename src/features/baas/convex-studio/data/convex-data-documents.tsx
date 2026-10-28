import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  PenLine,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { ConvexStudioDeployment } from "../convex-studio-sections";
import { ConvexDataConfirmDialog } from "./convex-data-confirm-dialog";
import { ConvexDataDocumentDialog } from "./convex-data-document-dialog";
import { ConvexDataFilterPanel } from "./convex-data-filter-panel";
import {
  activeFilterCount,
  cellPreview,
  compileFilter,
  dataKey,
  documentColumns,
  documentsText,
  EMPTY_FILTER,
  type FilterState,
  formatCreationTime,
  isConvexId,
  PAGE_SIZE,
  saveDocuments,
  schemaFields,
  validatorText,
} from "./convex-data-utils";

export function ConvexDataDocuments({
  deployment,
  table,
  schema,
  onOpenDocument,
  onOpenReference,
}: {
  deployment: ConvexStudioDeployment;
  table: string;
  schema: ConvexDataSchema | undefined;
  onOpenDocument: (document: ConvexDocument) => void;
  onOpenReference: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [filter, setFilter] = useState<FilterState>(EMPTY_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const [offsets, setOffsets] = useState([0]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dialog, setDialog] = useState<"insert" | "patch" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
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
  const page = documents.data?.documents ?? [];
  const columns = documentColumns(page, schemaTable);
  const selectedIds = page.filter((item) => selected.has(item._id)).map((item) => item._id);
  const searching = filter.mode === "search";

  function reset() {
    setCursors([null]);
    setOffsets([0]);
    setSelected(new Set());
  }

  async function refresh(delta = 0) {
    setSelected(new Set());
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
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b px-3 py-1.5">
        <Button
          variant={activeFilterCount(filter) ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowFilters((value) => !value)}
        >
          <Filter className="size-3.5" /> Filter
          {activeFilterCount(filter) ? ` (${activeFilterCount(filter)})` : ""}
        </Button>
        <Button size="sm" onClick={() => setDialog("insert")}>
          <Plus className="size-3.5" /> Dokument
        </Button>
        {selectedIds.length > 0 && (
          <>
            <Button variant="outline" size="sm" onClick={() => setDialog("patch")}>
              <PenLine className="size-3.5" /> Felder setzen ({selectedIds.length})
            </Button>
            <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="size-3.5" /> {selectedIds.length} löschen
            </Button>
          </>
        )}
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={page.length === 0}>
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
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dokumente aktualisieren"
            onClick={() => void refresh()}
            disabled={documents.isFetching}
          >
            <RefreshCw className={`size-3.5 ${documents.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      {showFilters && (
        <div className="shrink-0 border-b px-3 py-2">
          <ConvexDataFilterPanel
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
        <p role="alert" className="p-4 text-xs text-destructive">
          {String(documents.error)}
        </p>
      ) : documents.isPending && filterError === null ? (
        <p className="p-4 text-xs text-muted-foreground">Dokumente werden geladen…</p>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-auto">
            <table className="min-w-full border-separate border-spacing-0 text-left text-xs">
              <caption className="sr-only">Dokumente der Tabelle {table}</caption>
              <thead className="sticky top-0 z-10 bg-muted">
                <tr className="[&>th]:border-b [&>th]:border-r [&>th]:border-border/70">
                  <th
                    scope="col"
                    className="w-10 px-2 py-2 text-right font-normal text-muted-foreground"
                  >
                    #
                  </th>
                  <th scope="col" className="w-8 px-2 py-2">
                    <Checkbox
                      aria-label="Alle Dokumente der Seite auswählen"
                      checked={page.length > 0 && selectedIds.length === page.length}
                      onCheckedChange={(value) =>
                        setSelected(new Set(value === true ? page.map((item) => item._id) : []))
                      }
                    />
                  </th>
                  {columns.map((column) => (
                    <th key={column} scope="col" className="px-3 py-1.5 font-medium">
                      {column === "_creationTime" ? (
                        <button
                          type="button"
                          disabled={searching}
                          onClick={() => {
                            setOrder((value) => (value === "desc" ? "asc" : "desc"));
                            reset();
                          }}
                          className="flex items-center gap-1 whitespace-nowrap hover:text-foreground disabled:opacity-60"
                          aria-label={`Sortierung umkehren (aktuell ${order === "desc" ? "absteigend" : "aufsteigend"})`}
                        >
                          <span className="font-mono">{column}</span>
                          {!searching &&
                            (order === "desc" ? (
                              <ArrowDown className="size-3" />
                            ) : (
                              <ArrowUp className="size-3" />
                            ))}
                        </button>
                      ) : (
                        <span className="font-mono whitespace-nowrap">{column}</span>
                      )}
                      {fields?.[column] && (
                        <span className="block max-w-48 truncate text-[10px] font-normal text-muted-foreground">
                          {validatorText(fields[column].fieldType)}
                          {fields[column].optional ? "?" : ""}
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {page.map((document, index) => (
                  <tr
                    key={document._id}
                    className="hover:bg-muted/40 [&>td]:border-b [&>td]:border-r [&>td]:border-border/60"
                  >
                    <td className="px-2 py-1.5 text-right align-top text-muted-foreground tabular-nums">
                      {(offsets.at(-1) ?? 0) + index + 1}
                    </td>
                    <td className="px-2 py-1.5 align-top">
                      <Checkbox
                        aria-label="Dokument auswählen"
                        checked={selected.has(document._id)}
                        onCheckedChange={(value) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (value === true) next.add(document._id);
                            else next.delete(document._id);
                            return next;
                          })
                        }
                      />
                    </td>
                    {columns.map((column) => {
                      const value = document[column];
                      const reference = column !== "_id" && isConvexId(value);
                      return (
                        <td key={column} className="max-w-64 px-3 py-1.5 align-top">
                          <button
                            type="button"
                            title={
                              reference ? "Referenziertes Dokument öffnen" : "Dokument anzeigen"
                            }
                            onClick={() =>
                              reference ? onOpenReference(value) : onOpenDocument(document)
                            }
                            className={`block max-w-64 truncate text-left font-mono hover:underline ${value === undefined ? "text-muted-foreground italic" : ""} ${reference ? "text-primary" : ""}`}
                          >
                            {column === "_creationTime"
                              ? formatCreationTime(value)
                              : value === undefined
                                ? "unset"
                                : cellPreview(value).slice(0, 200)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {page.length === 0 && filterError === null && (
              <p className="p-4 text-xs text-muted-foreground">
                {activeFilterCount(filter) ? "Keine passenden Dokumente." : "Die Tabelle ist leer."}
              </p>
            )}
          </div>
          <div className="flex h-9 shrink-0 items-center gap-2 border-t px-3 text-xs text-muted-foreground">
            <span className="tabular-nums">
              Seite {cursors.length}
              {page.length ? ` · ${page.length} Dokumente` : ""}
            </span>
            {selectedIds.length > 0 && <span>{selectedIds.length} ausgewählt</span>}
            <span className="ml-auto" />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Zurück"
              disabled={cursors.length === 1 || documents.isFetching}
              onClick={() => {
                setCursors((value) => value.slice(0, -1));
                setOffsets((value) => value.slice(0, -1));
                setSelected(new Set());
              }}
            >
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Weiter"
              disabled={!documents.data?.has_more || documents.isFetching}
              onClick={() => {
                const next = documents.data?.cursor ?? null;
                if (next) {
                  setCursors((value) => [...value, next]);
                  setOffsets((value) => [...value, (value.at(-1) ?? 0) + page.length]);
                }
                setSelected(new Set());
              }}
            >
              <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </>
      )}
      {dialog && (
        <ConvexDataDocumentDialog
          mode={dialog}
          table={table}
          count={selectedIds.length}
          initial={dialog === "insert" ? "{\n  \n}" : "{}"}
          onOpenChange={(open) => !open && setDialog(null)}
          onSubmit={async (items) => {
            if (dialog === "insert") {
              const inserted = await convexDataInsert(deployment, table, items);
              setMessage(`${inserted} Dokumente eingefügt.`);
              await refresh(inserted);
              return;
            }
            await convexDataPatch(deployment, table, selectedIds, items[0]);
            setMessage(`${selectedIds.length} Dokumente aktualisiert.`);
            await refresh();
          }}
        />
      )}
      <ConvexDataConfirmDialog
        open={confirmDelete}
        title={`${selectedIds.length} Dokumente löschen?`}
        description={`Die ausgewählten Dokumente werden endgültig aus ${table} gelöscht.`}
        action="Löschen"
        onOpenChange={setConfirmDelete}
        onConfirm={async () => {
          const deleted = await convexDataDelete(deployment, table, selectedIds);
          setMessage(`${deleted} Dokumente gelöscht.`);
          await refresh(-deleted);
        }}
      />
    </div>
  );
}
