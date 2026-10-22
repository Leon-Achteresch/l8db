import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Filter,
  Pencil,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { copyWithToast } from "@/lib/clipboard";
import {
  type StudioColumn,
  type StudioRow,
  type StudioRowFilter,
  type StudioTableInfo,
  studioTablesDeleteRows,
  studioTablesInsertRow,
  studioTablesRows,
  studioTablesUpdateRow,
} from "@/lib/db/supabase-studio-tables";
import { SupabaseTableCellDialog } from "./supabase-table-cell-dialog";
import { SupabaseTableConfirmDialog } from "./supabase-table-confirm-dialog";
import { SupabaseTableFilters } from "./supabase-table-filters";
import { SupabaseTableRowDialog } from "./supabase-table-row-dialog";
import {
  cellPreview,
  isWritableKind,
  PAGE_SIZE,
  rowKey,
  rowsCsvText,
  rowsJson,
  saveRows,
} from "./supabase-tables-utils";

export function SupabaseTableGrid({
  reference,
  info,
  sql,
}: {
  reference: string;
  info: StudioTableInfo;
  sql: boolean;
}) {
  const queryClient = useQueryClient();
  const primary = info.columns.filter((column) => column.is_primary_key).map((c) => c.name);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<{ column: string; desc: boolean } | null>(
    primary[0] ? { column: primary[0], desc: false } : null,
  );
  const [filters, setFilters] = useState<StudioRowFilter[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cell, setCell] = useState<{ column: string; dataType: string; value: unknown } | null>(
    null,
  );
  const [editing, setEditing] = useState<{ row: StudioRow | null } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [manualKey, setManualKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const rowsKey = ["supabase", reference, "studio-tables", "rows", info.schema, info.name];
  const rows = useQuery({
    queryKey: [...rowsKey, offset, sort, filters],
    queryFn: () =>
      studioTablesRows(reference, info.schema, info.name, {
        offset,
        sort_column: sort?.column ?? null,
        sort_desc: sort?.desc ?? false,
        filters,
      }),
  });

  const pageRows = rows.data?.rows ?? [];
  const columns: StudioColumn[] = info.columns.length
    ? info.columns
    : Object.keys(pageRows[0] ?? {}).map((name) => ({
        name,
        data_type: "",
        nullable: true,
        default_value: null,
        is_primary_key: false,
        is_unique: false,
        is_identity: false,
        is_generated: false,
        enum_values: null,
      }));
  const columnNames = columns.map((column) => column.name);
  const guessedKey = columnNames.includes("id") ? "id" : null;
  const keyColumns = primary.length
    ? primary
    : !info.introspected && (manualKey ?? guessedKey)
      ? [manualKey ?? guessedKey ?? ""]
      : [];
  const writableKind = isWritableKind(info.kind);
  const canEdit = writableKind && keyColumns.length > 0;
  const readOnlyReason = !writableKind
    ? "Views und Fremdtabellen sind hier nur lesbar."
    : keyColumns.length === 0
      ? info.introspected
        ? "Die Tabelle hat keinen Primärschlüssel. Ohne eindeutigen Schlüssel ist sie nur lesbar."
        : "Wähle eine Schlüsselspalte, um Zeilen zu bearbeiten oder zu löschen."
      : null;
  const identify = (row: StudioRow) => JSON.stringify(rowKey(row, keyColumns));
  const selectedRows = canEdit ? pageRows.filter((row) => selected.has(identify(row))) : [];

  function refresh() {
    setSelected(new Set());
    void queryClient.invalidateQueries({ queryKey: rowsKey });
  }

  function toggleSort(column: string) {
    setOffset(0);
    setSort((current) =>
      current?.column !== column
        ? { column, desc: false }
        : current.desc
          ? null
          : { column, desc: true },
    );
  }

  async function exportRows(format: "csv" | "json", target: "copy" | "save") {
    setMessage(null);
    try {
      if (target === "copy") {
        await copyWithToast(
          format === "csv" ? rowsCsvText(columnNames, pageRows) : rowsJson(pageRows),
          format.toUpperCase(),
        );
      } else if (await saveRows(`${info.schema}_${info.name}`, format, columnNames, pageRows)) {
        setMessage("Export gespeichert.");
      }
    } catch (cause) {
      setMessage(String(cause));
    }
  }

  return (
    <div className="grid min-w-0 gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant={filters.length ? "secondary" : "outline"}
          size="sm"
          onClick={() => setShowFilters((value) => !value)}
        >
          <Filter className="size-3.5" /> Filter{filters.length ? ` (${filters.length})` : ""}
        </Button>
        {writableKind && (
          <Button size="sm" onClick={() => setEditing({ row: null })}>
            <Plus className="size-3.5" /> Zeile
          </Button>
        )}
        {canEdit && selectedRows.length > 0 && (
          <Button variant="destructive" size="sm" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="size-3.5" /> {selectedRows.length} löschen
          </Button>
        )}
        {!info.introspected && primary.length === 0 && writableKind && columnNames.length > 0 && (
          <Select value={keyColumns[0] ?? ""} onValueChange={setManualKey}>
            <SelectTrigger size="sm" className="h-8 w-48 text-xs" aria-label="Schlüsselspalte">
              <SelectValue placeholder="Schlüsselspalte" />
            </SelectTrigger>
            <SelectContent>
              {columnNames.map((name) => (
                <SelectItem key={name} value={name}>
                  Schlüssel: {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        <div className="ml-auto flex items-center gap-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={pageRows.length === 0}>
                <Download className="size-3.5" /> Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => void exportRows("csv", "copy")}>
                Seite als CSV kopieren
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportRows("json", "copy")}>
                Seite als JSON kopieren
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => void exportRows("csv", "save")}>
                Seite als CSV speichern…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void exportRows("json", "save")}>
                Seite als JSON speichern…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Zeilen aktualisieren"
            onClick={refresh}
            disabled={rows.isFetching}
          >
            <RefreshCw className={`size-3.5 ${rows.isFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>
      {showFilters && (
        <SupabaseTableFilters
          columns={columnNames}
          filters={filters}
          onApply={(next) => {
            setFilters(next);
            setOffset(0);
            setSelected(new Set());
          }}
        />
      )}
      {readOnlyReason && <p className="text-xs text-muted-foreground">{readOnlyReason}</p>}
      {!sql && (
        <p className="text-xs text-muted-foreground">
          Zugriff über die Data API: Row Level Security gilt für alle Lese- und Schreibzugriffe.
        </p>
      )}
      {message && (
        <p role="status" className="text-xs text-muted-foreground">
          {message}
        </p>
      )}
      {rows.isPending ? (
        <p className="text-xs text-muted-foreground">Zeilen werden geladen…</p>
      ) : rows.isError ? (
        <p role="alert" className="text-xs text-destructive">
          {String(rows.error)}
        </p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="min-w-full text-left text-xs">
              <caption className="sr-only">
                Zeilen der Tabelle {info.schema}.{info.name}
              </caption>
              <thead className="bg-muted/50">
                <tr>
                  {canEdit && (
                    <th scope="col" className="w-8 px-2 py-2">
                      <Checkbox
                        aria-label="Alle Zeilen der Seite auswählen"
                        checked={pageRows.length > 0 && selectedRows.length === pageRows.length}
                        onCheckedChange={(value) =>
                          setSelected(new Set(value === true ? pageRows.map(identify) : []))
                        }
                      />
                    </th>
                  )}
                  {columns.map((column) => (
                    <th key={column.name} scope="col" className="px-3 py-1.5 font-medium">
                      <button
                        type="button"
                        onClick={() => toggleSort(column.name)}
                        className="flex items-center gap-1 whitespace-nowrap hover:text-foreground"
                        aria-label={`Nach ${column.name} sortieren`}
                      >
                        <span className="font-mono">{column.name}</span>
                        {sort?.column === column.name &&
                          (sort.desc ? (
                            <ArrowDown className="size-3" />
                          ) : (
                            <ArrowUp className="size-3" />
                          ))}
                      </button>
                      <span className="block text-[10px] font-normal text-muted-foreground">
                        {column.data_type}
                        {column.is_primary_key ? " · PK" : ""}
                      </span>
                    </th>
                  ))}
                  <th scope="col" className="w-16 px-2 py-2">
                    <span className="sr-only">Aktionen</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, index) => {
                  const id = canEdit ? identify(row) : String(index);
                  return (
                    <tr key={id} className="border-t">
                      {canEdit && (
                        <td className="px-2 py-1.5 align-top">
                          <Checkbox
                            aria-label="Zeile auswählen"
                            checked={selected.has(id)}
                            onCheckedChange={(value) =>
                              setSelected((current) => {
                                const next = new Set(current);
                                if (value === true) next.add(id);
                                else next.delete(id);
                                return next;
                              })
                            }
                          />
                        </td>
                      )}
                      {columns.map((column) => {
                        const value = row[column.name];
                        return (
                          <td key={column.name} className="max-w-64 px-3 py-1.5 align-top">
                            <button
                              type="button"
                              onClick={() =>
                                setCell({ column: column.name, dataType: column.data_type, value })
                              }
                              className={`block max-w-64 truncate text-left font-mono hover:underline ${value === null || value === undefined ? "text-muted-foreground italic" : ""}`}
                            >
                              {cellPreview(value).slice(0, 200)}
                            </button>
                          </td>
                        );
                      })}
                      <td className="px-2 py-1 align-top whitespace-nowrap">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Zeile als JSON kopieren"
                          onClick={() => void copyWithToast(JSON.stringify(row, null, 2), "Zeile")}
                        >
                          <Copy />
                        </Button>
                        {canEdit && (
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Zeile bearbeiten"
                            onClick={() => setEditing({ row })}
                          >
                            <Pencil />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pageRows.length === 0 && (
            <p className="text-xs text-muted-foreground">Keine Zeilen auf dieser Seite.</p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={offset === 0}
              onClick={() => {
                setOffset((value) => Math.max(0, value - PAGE_SIZE));
                setSelected(new Set());
              }}
            >
              <ChevronLeft className="size-3.5" /> Zurück
            </Button>
            <span className="text-[11px] text-muted-foreground">
              {pageRows.length ? `${offset + 1}–${offset + pageRows.length}` : "–"}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={!rows.data.has_more}
              onClick={() => {
                setOffset((value) => value + PAGE_SIZE);
                setSelected(new Set());
              }}
            >
              Weiter <ChevronRight className="size-3.5" />
            </Button>
          </div>
        </>
      )}
      <SupabaseTableCellDialog cell={cell} onClose={() => setCell(null)} />
      {editing && (
        <SupabaseTableRowDialog
          open
          columns={columns}
          row={editing.row}
          sql={sql}
          onOpenChange={(open) => !open && setEditing(null)}
          onSubmit={async (values) => {
            if (editing.row) {
              await studioTablesUpdateRow(
                reference,
                info.schema,
                info.name,
                rowKey(editing.row, keyColumns),
                values,
              );
            } else {
              await studioTablesInsertRow(reference, info.schema, info.name, values);
            }
            refresh();
          }}
        />
      )}
      <SupabaseTableConfirmDialog
        open={confirmDelete}
        title={`${selectedRows.length} Zeilen löschen?`}
        description={`Die ausgewählten Zeilen werden endgültig aus ${info.schema}.${info.name} gelöscht.`}
        action="Löschen"
        onOpenChange={setConfirmDelete}
        onConfirm={async () => {
          const deleted = await studioTablesDeleteRows(
            reference,
            info.schema,
            info.name,
            selectedRows.map((row) => rowKey(row, keyColumns)),
          );
          setMessage(`${deleted} Zeilen gelöscht.`);
          refresh();
        }}
      />
    </div>
  );
}
