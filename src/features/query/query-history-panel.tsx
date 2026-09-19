import { DownloadIcon, PlayIcon, SearchIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { firstLine } from "@/features/query/query-history-panel/format";
import { HistoryEntryItem } from "@/features/query/query-history-panel/history-entry-item";
import { SavedQueriesExportDialog } from "@/features/query/saved-queries-export-dialog";
import { SavedQueriesImportDialog } from "@/features/query/saved-queries-import-dialog";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useQueryHistoryStore } from "@/lib/query-history";
import { useSavedQueriesStore } from "@/lib/saved-queries";

interface QueryHistoryPanelProps {
  connectionId: string | null;
  onLoad: (sql: string, mode?: "new" | "replace") => void;
}

export function QueryHistoryPanel({ connectionId, onLoad }: QueryHistoryPanelProps) {
  const [tab, setTab] = useState<"history" | "saved">("history");
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [search, setSearch] = useState("");
  const entries = useQueryHistoryStore((state) => state.entries);
  const removeEntry = useQueryHistoryStore((state) => state.removeEntry);
  const clearForConnection = useQueryHistoryStore((state) => state.clearForConnection);
  const savedQueries = useSavedQueriesStore((state) => state.queries);
  const deleteQuery = useSavedQueriesStore((state) => state.deleteQuery);
  const limit = useQueryHistoryStore((state) => state.retentionLimit);
  const restore = useQueryHistoryStore((state) => state.restore);
  const undoableRemove = (id: string) => {
    const entry = entries.find((item) => item.id === id);
    if (!entry) return;
    removeEntry(id);
    toast("Verlaufseintrag entfernt", {
      action: { label: "Rückgängig", onClick: () => restore([entry]) },
    });
  };
  const undoableDelete = (id: string) => {
    const entry = savedQueries.find((item) => item.id === id);
    if (!entry) return;
    deleteQuery(id);
    toast("Query entfernt", {
      action: {
        label: "Rückgängig",
        onClick: () => useSavedQueriesStore.getState().importQueries([entry]),
      },
    });
  };

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

  return (
    <motion.div
      layout
      transition={{ layout: SPRING_LAYOUT }}
      className="flex h-full w-full min-w-0 flex-col bg-muted/20"
    >
      <div className="shrink-0 border-b px-4 py-3">
        <SegmentedControl
          value={tab}
          onChange={setTab}
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
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
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "history" ? (
          history.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              {search
                ? "Keine Treffer. Suche ändern oder leeren."
                : "Noch keine Queries ausgeführt."}
            </p>
          ) : (
            <div className="divide-y divide-border/50">
              {connectionId && (
                <div className="flex justify-end p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                    onClick={() => {
                      const removed = entries.filter(
                        (entry) => entry.connectionId === connectionId,
                      );
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
              {history.map((entry) => (
                <HistoryEntryItem
                  key={entry.id}
                  entry={entry}
                  onLoad={onLoad}
                  undoableRemove={undoableRemove}
                />
              ))}
            </div>
          )
        ) : (
          <div className="divide-y divide-border/50">
            <div className="flex justify-end gap-1 p-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                onClick={() => setImportOpen(true)}
              >
                <UploadIcon className="size-3" />
                Importieren
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                onClick={() => setExportOpen(true)}
                disabled={savedQueries.length === 0}
              >
                <DownloadIcon className="size-3" />
                Exportieren
              </Button>
            </div>
            {saved.length === 0 && (
              <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                Keine gespeicherten Queries. Über „Speichern“ legst du eine an.
              </p>
            )}
            {saved.map((item) => (
              <motion.div
                key={item.id}
                layout
                transition={{ layout: SPRING_LAYOUT }}
                className="group px-3 py-2 hover:bg-muted/40"
              >
                <button
                  type="button"
                  className="block w-full text-left"
                  onClick={() => onLoad(item.sql, "new")}
                  title="In neuem SQL-Tab öffnen"
                >
                  <p className="truncate text-xs font-medium">{item.name}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {firstLine(item.sql)}
                  </p>
                </button>
                <div className="mt-1 hidden flex-wrap gap-1 group-hover:flex group-focus-within:flex">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[11px]"
                    onClick={() => onLoad(item.sql, "new")}
                  >
                    <PlayIcon className="size-3" />
                    Neuer Tab
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                    onClick={() => undoableDelete(item.id)}
                  >
                    <Trash2Icon className="size-3" />
                    Löschen
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>

      <SavedQueriesExportDialog
        open={exportOpen}
        queries={savedQueries}
        onOpenChange={setExportOpen}
      />
      <SavedQueriesImportDialog open={importOpen} onOpenChange={setImportOpen} />
    </motion.div>
  );
}
