import { useVirtualizer } from "@tanstack/react-virtual";
import { DownloadIcon, SearchIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { type RefObject, useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { HistoryEntryItem } from "@/features/query/query-history-panel/history-entry-item";
import { SavedQueryItem } from "@/features/query/query-history-panel/saved-query-item";
import { SavedQueriesExportDialog } from "@/features/query/saved-queries-export-dialog";
import { SavedQueriesImportDialog } from "@/features/query/saved-queries-import-dialog";
import { createFreshElementScroll } from "@/lib/fresh-element-scroll";
import { observeVirtualScrollRect } from "@/lib/observe-virtual-scroll-rect";
import { useQueryHistoryStore } from "@/lib/query-history";
import { useSavedQueriesStore } from "@/lib/saved-queries";
import { measureVirtualItem } from "@/lib/virtual-item-measurement";

interface QueryHistoryPanelProps {
  connectionId: string | null;
  onLoad: (sql: string, mode?: "new" | "replace") => void;
  searchRef?: RefObject<HTMLInputElement | null>;
}

export function QueryHistoryPanel({ connectionId, onLoad, searchRef }: QueryHistoryPanelProps) {
  const [tab, setTab] = useState<"history" | "saved">("history");
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const exportTriggerRef = useRef<HTMLButtonElement>(null);
  const importTriggerRef = useRef<HTMLButtonElement>(null);
  const entries = useQueryHistoryStore((state) => state.entries);
  const removeEntry = useQueryHistoryStore((state) => state.removeEntry);
  const clearForConnection = useQueryHistoryStore((state) => state.clearForConnection);
  const savedQueries = useSavedQueriesStore((state) => state.queries);
  const deleteQuery = useSavedQueriesStore((state) => state.deleteQuery);
  const limit = useQueryHistoryStore((state) => state.retentionLimit);
  const restore = useQueryHistoryStore((state) => state.restore);
  const undoableRemove = useCallback(
    (id: string) => {
      const entry = entries.find((item) => item.id === id);
      if (!entry) return;
      removeEntry(id);
      toast("Verlaufseintrag entfernt", {
        action: { label: "Rückgängig", onClick: () => restore([entry]) },
      });
    },
    [entries, removeEntry, restore],
  );
  const undoableDelete = useCallback(
    (id: string) => {
      const entry = savedQueries.find((item) => item.id === id);
      if (!entry) return;
      deleteQuery(id);
      toast("Query entfernt", {
        action: {
          label: "Rückgängig",
          onClick: () => useSavedQueriesStore.getState().importQueries([entry]),
        },
      });
    },
    [savedQueries, deleteQuery],
  );

  const history = useMemo(() => {
    const query = search.trim().toLowerCase();
    return entries.filter(
      (entry) =>
        (!connectionId || entry.connectionId === connectionId) &&
        (!query || entry.sql.toLowerCase().includes(query)),
    );
  }, [entries, connectionId, search]);

  const saved = useMemo(() => {
    const query = search.trim().toLowerCase();
    return savedQueries.filter(
      (item) =>
        !query || item.sql.toLowerCase().includes(query) || item.name.toLowerCase().includes(query),
    );
  }, [savedQueries, search]);

  const visibleEntries = tab === "history" ? history : saved;
  const scrollToFn = useMemo(() => createFreshElementScroll<HTMLDivElement, HTMLDivElement>(), []);
  const getItemKey = useCallback(
    (index: number) => `${tab}:${visibleEntries[index].id}`,
    [tab, visibleEntries],
  );
  const virtualizer = useVirtualizer({
    count: visibleEntries.length,
    getScrollElement: () => scrollRef.current,
    scrollToFn,
    estimateSize: () => 64,
    measureElement: measureVirtualItem,
    observeElementRect: observeVirtualScrollRect,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
    getItemKey,
    overscan: 3,
    initialRect: { width: 480, height: 600 },
  });

  return (
    <div className="flex h-full w-full min-w-0 flex-col bg-muted/20">
      <div className="shrink-0 border-b px-4 py-3">
        <SegmentedControl
          value={tab}
          onChange={(value) => {
            setTab(value);
            scrollRef.current?.scrollTo({ top: 0 });
          }}
          label="Query-Bibliothek"
          options={[
            { value: "history", label: "Verlauf" },
            { value: "saved", label: "Gespeichert" },
          ]}
        />
      </div>

      <div className="shrink-0 border-b p-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={searchRef}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              scrollRef.current?.scrollTo({ top: 0 });
            }}
            placeholder="Suchen…"
            aria-label="Query-Verlauf durchsuchen"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <p className="border-b px-3 py-2 text-[10px] text-muted-foreground">
        Bis zu {limit} Einträge je Verbindung. Sehr lange SQL-Texte werden gekennzeichnet gekürzt.
        Aufbewahrung in den Einstellungen ändern.
      </p>
      {tab === "history" && connectionId && history.length > 0 && (
        <div className="flex shrink-0 justify-end border-b p-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => {
              const removed = entries.filter((entry) => entry.connectionId === connectionId);
              clearForConnection(connectionId);
              toast("Verlauf entfernt", {
                action: { label: "Rückgängig", onClick: () => restore(removed) },
              });
            }}
          >
            <Trash2Icon className="size-3" />
            Verlauf dieser Verbindung löschen
          </Button>
        </div>
      )}
      {tab === "saved" && (
        <div className="flex shrink-0 justify-end gap-1 border-b p-2">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => setImportOpen(true)}
            ref={importTriggerRef}
          >
            <UploadIcon className="size-3" />
            Importieren
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
            onClick={() => setExportOpen(true)}
            ref={exportTriggerRef}
            disabled={savedQueries.length === 0}
          >
            <DownloadIcon className="size-3" />
            Exportieren
          </Button>
        </div>
      )}
      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto"
        data-slot="query-history-list"
        style={{ contain: "strict" }}
      >
        {visibleEntries.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            {tab === "saved"
              ? "Keine gespeicherten Queries. Über „Speichern“ legst du eine an."
              : search
                ? "Keine Treffer. Suche ändern oder leeren."
                : "Noch keine Queries ausgeführt."}
          </p>
        ) : (
          <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualRow) => (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="absolute top-0 left-0 w-full border-b border-border/50"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                {tab === "history" ? (
                  <HistoryEntryItem
                    entry={history[virtualRow.index]}
                    onLoad={onLoad}
                    undoableRemove={undoableRemove}
                  />
                ) : (
                  <SavedQueryItem
                    entry={saved[virtualRow.index]}
                    onLoad={onLoad}
                    onDelete={undoableDelete}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {exportOpen && (
        <SavedQueriesExportDialog
          open={exportOpen}
          queries={savedQueries}
          onOpenChange={setExportOpen}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            exportTriggerRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
      {importOpen && (
        <SavedQueriesImportDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            importTriggerRef.current?.focus({ preventScroll: true });
          }}
        />
      )}
    </div>
  );
}
