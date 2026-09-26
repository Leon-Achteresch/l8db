import { FileIcon, FolderIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { formatBytes } from "@/lib/backup";
import { cn } from "@/lib/utils";
import { ObjectRowMenu, type RowActions } from "./object-row-menu";
import type { BrowserMode, BrowserRow } from "./use-object-listing";
import { formatDate } from "./use-storage-connection";

export function ObjectList({
  bucket,
  rows,
  mode,
  selected,
  selectedRows,
  readOnly,
  actions,
  onSelect,
  onToggle,
  onToggleAll,
}: {
  bucket: string;
  rows: BrowserRow[];
  mode: BrowserMode;
  selected: Set<string>;
  selectedRows: BrowserRow[];
  readOnly: boolean;
  actions: RowActions;
  onSelect: (row: BrowserRow, index: number, event: React.MouseEvent) => void;
  onToggle: (row: BrowserRow) => void;
  onToggleAll: (checked: boolean) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center text-sm text-muted-foreground">
        <FolderIcon className="size-8 opacity-40" />
        {mode === "search" ? "Keine Treffer." : "Dieser Ordner ist leer."}
      </div>
    );
  }
  const allSelected = rows.length > 0 && rows.every((row) => selected.has(row.id));
  return (
    <table className="w-full border-collapse text-sm" aria-label="Objekte">
      <thead className="sticky top-0 z-10 bg-background text-xs text-muted-foreground shadow-[0_1px_0_var(--border)]">
        <tr>
          <th className="w-8 px-2 py-1.5">
            <Checkbox
              aria-label="Alle auswählen"
              checked={allSelected}
              onCheckedChange={(checked) => onToggleAll(checked === true)}
            />
          </th>
          <th className="px-2 py-1.5 text-left font-medium">Name</th>
          {mode === "versions" && <th className="px-2 py-1.5 text-left font-medium">Version</th>}
          <th className="w-24 px-2 py-1.5 text-right font-medium">Größe</th>
          <th className="w-44 px-2 py-1.5 text-left font-medium">Geändert</th>
          <th className="w-28 px-2 py-1.5 text-left font-medium">Klasse</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => {
          const isSelected = selected.has(row.id);
          const targets = isSelected && selectedRows.length > 1 ? selectedRows : [row];
          return (
            <ContextMenu key={row.id}>
              <ContextMenuTrigger asChild>
                <tr
                  data-key={row.key}
                  data-kind={row.kind}
                  aria-selected={isSelected}
                  className={cn(
                    "cursor-default border-b border-border/50 select-none hover:bg-muted/50",
                    isSelected && "bg-primary/10 hover:bg-primary/15",
                    row.deleteMarker && "text-muted-foreground line-through",
                  )}
                  onClick={(event) => onSelect(row, index, event)}
                  onDoubleClick={() => actions.open(row)}
                  onContextMenu={(event) => {
                    if (!isSelected) onSelect(row, index, event);
                  }}
                >
                  <td className="px-2 py-1" onClick={(event) => event.stopPropagation()}>
                    <Checkbox
                      aria-label={`${row.name} auswählen`}
                      checked={isSelected}
                      onCheckedChange={() => onToggle(row)}
                    />
                  </td>
                  <td className="max-w-0 px-2 py-1">
                    <span className="flex min-w-0 items-center gap-2">
                      {row.kind === "folder" ? (
                        <FolderIcon className="size-4 shrink-0 text-amber-500" />
                      ) : (
                        <FileIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate" title={row.key}>
                        {row.name || row.key}
                      </span>
                    </span>
                  </td>
                  {mode === "versions" && (
                    <td className="px-2 py-1 text-xs">
                      {row.versionId ? (
                        <span className="flex items-center gap-1.5">
                          <span className="max-w-32 truncate font-mono" title={row.versionId}>
                            {row.versionId}
                          </span>
                          {row.isLatest && <Badge variant="secondary">aktuell</Badge>}
                          {row.deleteMarker && <Badge variant="outline">Delete-Marker</Badge>}
                        </span>
                      ) : null}
                    </td>
                  )}
                  <td className="px-2 py-1 text-right text-xs tabular-nums text-muted-foreground">
                    {row.size === null ? "" : formatBytes(row.size)}
                  </td>
                  <td className="px-2 py-1 text-xs text-muted-foreground">
                    {row.lastModified ? formatDate(row.lastModified) : ""}
                  </td>
                  <td className="px-2 py-1 text-xs text-muted-foreground">
                    {row.storageClass ?? ""}
                  </td>
                </tr>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ObjectRowMenu
                  bucket={bucket}
                  row={row}
                  targets={targets}
                  readOnly={readOnly}
                  actions={actions}
                />
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </tbody>
    </table>
  );
}
