import { BookmarkIcon, HistoryIcon, PlayIcon, SearchIcon, Trash2Icon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SPRING_LAYOUT } from "@/lib/ease";
import { useQueryHistoryStore } from "@/lib/query-history";
import { useSavedQueriesStore } from "@/lib/saved-queries";

interface QueryHistoryPanelProps {
  connectionId: string | null;
  onLoad: (sql: string) => void;
  onClose: () => void;
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function firstLine(sql: string): string {
  const line =
    sql
      .split("\n")
      .map((part) => part.trim())
      .filter(Boolean)[0] ?? "";
  return line.length > 80 ? `${line.slice(0, 80)}…` : line;
}

export function QueryHistoryPanel({ connectionId, onLoad, onClose }: QueryHistoryPanelProps) {
  const [tab, setTab] = useState("history");
  const [search, setSearch] = useState("");
  const entries = useQueryHistoryStore((state) => state.entries);
  const removeEntry = useQueryHistoryStore((state) => state.removeEntry);
  const clearForConnection = useQueryHistoryStore((state) => state.clearForConnection);
  const savedQueries = useSavedQueriesStore((state) => state.queries);
  const deleteQuery = useSavedQueriesStore((state) => state.deleteQuery);

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
      className="flex h-full w-80 shrink-0 flex-col border-l bg-muted/20"
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Tabs value={tab} onValueChange={setTab} className="min-w-0 flex-1">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="history" className="gap-1.5 text-xs">
              <HistoryIcon className="size-3.5" />
              Verlauf
            </TabsTrigger>
            <TabsTrigger value="saved" className="gap-1.5 text-xs">
              <BookmarkIcon className="size-3.5" />
              Gespeichert
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          onClick={onClose}
          title="Schließen"
        >
          <XIcon className="size-4" />
        </Button>
      </div>

      <div className="shrink-0 border-b p-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen…"
            className="h-8 pl-8 text-xs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "history" ? (
          history.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              Noch keine Queries ausgeführt.
            </p>
          ) : (
            <div className="divide-y divide-border/50">
              {connectionId && (
                <div className="flex justify-end p-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                    onClick={() => clearForConnection(connectionId)}
                  >
                    <Trash2Icon className="size-3" />
                    Verlauf dieser Verbindung löschen
                  </Button>
                </div>
              )}
              {history.map((entry) => (
                <motion.div
                  key={entry.id}
                  layout
                  transition={{ layout: SPRING_LAYOUT }}
                  className="group px-3 py-2 hover:bg-muted/40"
                >
                  <button
                    type="button"
                    className="block w-full text-left"
                    onClick={() => onLoad(entry.sql)}
                    title="In den Editor laden"
                  >
                    <p className="truncate font-mono text-xs">{firstLine(entry.sql)}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                      <span>{formatTime(entry.ranAt)}</span>
                      {entry.durationMs != null && <span>· {entry.durationMs} ms</span>}
                      {entry.rowCount != null && <span>· {entry.rowCount} Zeilen</span>}
                      {entry.error && <span className="text-destructive">· Fehler</span>}
                    </p>
                  </button>
                  <div className="mt-1 hidden gap-1 group-hover:flex">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-1.5 text-[11px]"
                      onClick={() => onLoad(entry.sql)}
                    >
                      <PlayIcon className="size-3" />
                      Laden
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                      onClick={() => removeEntry(entry.id)}
                    >
                      <Trash2Icon className="size-3" />
                      Löschen
                    </Button>
                  </div>
                </motion.div>
              ))}
            </div>
          )
        ) : saved.length === 0 ? (
          <p className="px-4 py-8 text-center text-xs text-muted-foreground">
            Keine gespeicherten Queries. Über „Speichern“ legst du eine an.
          </p>
        ) : (
          <div className="divide-y divide-border/50">
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
                  onClick={() => onLoad(item.sql)}
                  title="In den Editor laden"
                >
                  <p className="truncate text-xs font-medium">{item.name}</p>
                  <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
                    {firstLine(item.sql)}
                  </p>
                </button>
                <div className="mt-1 hidden gap-1 group-hover:flex">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[11px]"
                    onClick={() => onLoad(item.sql)}
                  >
                    <PlayIcon className="size-3" />
                    Laden
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
                    onClick={() => deleteQuery(item.id)}
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
    </motion.div>
  );
}
