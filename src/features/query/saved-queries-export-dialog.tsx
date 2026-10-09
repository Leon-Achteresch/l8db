import { useVirtualizer } from "@tanstack/react-virtual";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile } from "@tauri-apps/plugin-fs";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { QueryHistoryDialogContent } from "@/features/query/query-history-dialog-content";
import { createFreshElementScroll } from "@/lib/fresh-element-scroll";
import { observeVirtualScrollRect } from "@/lib/observe-virtual-scroll-rect";
import { usePortalContainer } from "@/lib/portal-container";
import type { SavedQuery } from "@/lib/saved-queries";
import { serializeSavedQueryExport } from "@/lib/saved-queries-transfer";
import { measureVirtualItem } from "@/lib/virtual-item-measurement";

interface Props {
  open: boolean;
  queries: SavedQuery[];
  onOpenChange: (open: boolean) => void;
  onCloseAutoFocus?: (event: Event) => void;
}

export function SavedQueriesExportDialog({ open, queries, onOpenChange, onCloseAutoFocus }: Props) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(queries.map((query) => query.id)),
  );
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectAllId = useId();
  const titleId = useId();
  const descriptionId = useId();
  const scopedContainer = usePortalContainer();
  const scrollToFn = useMemo(() => createFreshElementScroll<HTMLDivElement, HTMLDivElement>(), []);
  const virtualizer = useVirtualizer({
    count: queries.length,
    getScrollElement: () => scrollRef.current,
    getItemKey: useCallback((index: number) => queries[index].id, [queries]),
    estimateSize: () => 36,
    measureElement: measureVirtualItem,
    observeElementRect: observeVirtualScrollRect,
    scrollToFn,
    overscan: 3,
    initialRect: { width: 450, height: 320 },
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
  });

  const chosen = useMemo(
    () => queries.filter((query) => selected.has(query.id)),
    [queries, selected],
  );
  const allSelected = queries.length > 0 && chosen.length === queries.length;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function exportSelected() {
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      const path = await save({
        defaultPath: "l8db-queries.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!path) return;
      await writeTextFile(path, serializeSavedQueryExport(chosen));
      toast.success(
        chosen.length === 1 ? "1 Query exportiert" : `${chosen.length} Queries exportiert`,
      );
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={!scopedContainer}>
      <QueryHistoryDialogContent
        className="max-w-lg"
        onCloseAutoFocus={onCloseAutoFocus}
        onDismiss={() => onOpenChange(false)}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      >
        <DialogHeader>
          <DialogTitle id={titleId}>Gespeicherte Queries exportieren</DialogTitle>
          <DialogDescription id={descriptionId}>
            Exportiert werden nur Name und SQL. Verbindungen, Passwörter und der Verlauf bleiben
            außen vor. Klick auf einen Eintrag zeigt das enthaltene SQL.
          </DialogDescription>
        </DialogHeader>
        {queries.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Es gibt noch keine gespeicherten Queries.
          </p>
        ) : (
          <div className="flex min-h-0 flex-col gap-1">
            <label
              htmlFor={selectAllId}
              className="flex items-center gap-2 border-b pb-2 text-xs text-muted-foreground"
            >
              <Checkbox
                checked={allSelected}
                id={selectAllId}
                aria-label="Alle Queries auswählen"
                onCheckedChange={(value) =>
                  setSelected(
                    value === true ? new Set(queries.map((query) => query.id)) : new Set(),
                  )
                }
              />
              Alle auswählen
            </label>
            <div
              ref={scrollRef}
              data-slot="saved-query-export-list"
              className="max-h-80 overflow-y-auto"
              style={{ height: Math.min(320, virtualizer.getTotalSize()), contain: "strict" }}
            >
              <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
                {virtualizer.getVirtualItems().map((virtualRow) => {
                  const query = queries[virtualRow.index];
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={virtualizer.measureElement}
                      className="absolute top-0 left-0 w-full rounded-md px-1 py-1 hover:bg-muted/40"
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={selected.has(query.id)}
                          aria-label={`${query.name} auswählen`}
                          onCheckedChange={() => toggle(query.id)}
                        />
                        <button
                          type="button"
                          className="min-w-0 flex-1 text-left"
                          onClick={() => setExpanded(expanded === query.id ? null : query.id)}
                          title="SQL anzeigen"
                        >
                          <span className="block truncate text-sm">{query.name}</span>
                        </button>
                      </div>
                      {expanded === query.id && (
                        <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted/60 p-2 font-mono text-[11px] whitespace-pre-wrap">
                          {query.sql}
                        </pre>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={exportSelected} disabled={busy || chosen.length === 0}>
            {chosen.length === 1 ? "1 Query exportieren" : `${chosen.length} Queries exportieren`}
          </Button>
        </DialogFooter>
      </QueryHistoryDialogContent>
    </Dialog>
  );
}
