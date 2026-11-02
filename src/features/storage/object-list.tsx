import { useVirtualizer } from "@tanstack/react-virtual";
import { FileIcon, FolderIcon } from "lucide-react";
import { type RefObject, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { formatBytes } from "@/lib/backup";
import { cn } from "@/lib/utils";
import { ObjectRowMenu, type RowActions } from "./object-row-menu";
import type { BrowserMode, BrowserRow } from "./use-object-listing";
import { formatDate } from "./use-storage-connection";

const ROW_HEIGHT = 29;

type SelectModifiers = { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean };

export function ObjectList({
  bucket,
  rows,
  mode,
  selected,
  selectedRows,
  readOnly,
  filtered = false,
  scrollRef,
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
  filtered?: boolean;
  scrollRef?: RefObject<HTMLDivElement | null>;
  actions: RowActions;
  onSelect: (row: BrowserRow, index: number, event: SelectModifiers) => void;
  onToggle: (row: BrowserRow) => void;
  onToggleAll: (checked: boolean) => void;
}) {
  const bodyRef = useRef<HTMLTableSectionElement>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef?.current ?? null,
    estimateSize: () => ROW_HEIGHT,
    initialRect: { width: 0, height: 900 },
    overscan: 20,
    useFlushSync: false,
  });
  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-8 text-center text-sm text-muted-foreground">
        <FolderIcon className="size-8 opacity-40" />
        {mode === "search"
          ? "Keine Treffer."
          : filtered
            ? "Keine Treffer in den geladenen Einträgen. Enter im Filterfeld sucht rekursiv."
            : "Dieser Ordner ist leer."}
      </div>
    );
  }
  const items = virtualizer.getVirtualItems();
  const padTop = items[0]?.start ?? 0;
  const padBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);
  const current = Math.min(focusIndex, rows.length - 1);

  function moveFocus(index: number, event: React.KeyboardEvent) {
    const next = Math.max(0, Math.min(rows.length - 1, index));
    setFocusIndex(next);
    onSelect(rows[next], next, { metaKey: false, ctrlKey: false, shiftKey: event.shiftKey });
    virtualizer.scrollToIndex(next);
    requestAnimationFrame(() =>
      bodyRef.current?.querySelector<HTMLElement>(`tr[data-index="${next}"]`)?.focus(),
    );
  }

  function onRowKeyDown(row: BrowserRow, index: number, event: React.KeyboardEvent) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      moveFocus(index + (event.key === "ArrowDown" ? 1 : -1), event);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      moveFocus(event.key === "Home" ? 0 : rows.length - 1, event);
    } else if (event.key === "Enter") {
      event.preventDefault();
      actions.open(row);
    } else if (event.key === " ") {
      event.preventDefault();
      onToggle(row);
    }
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
      <tbody ref={bodyRef}>
        {padTop > 0 && <tr style={{ height: padTop }} />}
        {items.map(({ index }) => {
          const row = rows[index];
          const isSelected = selected.has(row.id);
          const targets = isSelected && selectedRows.length > 1 ? selectedRows : [row];
          return (
            <ContextMenu key={row.id}>
              <ContextMenuTrigger asChild>
                <tr
                  data-key={row.key}
                  data-kind={row.kind}
                  data-index={index}
                  tabIndex={index === current ? 0 : -1}
                  aria-selected={isSelected}
                  className={cn(
                    "cursor-default border-b border-border/50 select-none outline-none hover:bg-muted/50 focus-visible:bg-muted focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-inset",
                    isSelected && "bg-primary/10 hover:bg-primary/15",
                    row.deleteMarker && "text-muted-foreground line-through",
                  )}
                  onClick={(event) => {
                    setFocusIndex(index);
                    onSelect(row, index, event);
                  }}
                  onFocus={() => setFocusIndex(index)}
                  onKeyDown={(event) => onRowKeyDown(row, index, event)}
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
        {padBottom > 0 && <tr style={{ height: padBottom }} />}
      </tbody>
    </table>
  );
}
