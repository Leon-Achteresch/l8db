import { PlayIcon, Trash2Icon } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { firstLine, formatTime } from "@/features/query/query-history-panel/format";
import { SPRING_LAYOUT } from "@/lib/ease";
import type { QueryHistoryEntry } from "@/lib/query-history";
import { useSavedQueriesStore } from "@/lib/saved-queries";

interface HistoryEntryItemProps {
  entry: QueryHistoryEntry;
  onLoad: (sql: string, mode?: "new" | "replace") => void;
  undoableRemove: (id: string) => void;
}

export function HistoryEntryItem({ entry, onLoad, undoableRemove }: HistoryEntryItemProps) {
  return (
    <motion.div
      layout
      transition={{ layout: SPRING_LAYOUT }}
      className="group px-3 py-2 hover:bg-muted/40"
    >
      <button
        type="button"
        className="block w-full text-left"
        onClick={() => onLoad(entry.sql, "new")}
        title="In neuem SQL-Tab öffnen"
      >
        <p className="truncate font-mono text-xs">{firstLine(entry.sql)}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span>{formatTime(entry.ranAt)}</span>
          {entry.database && <span>· {entry.database}</span>}
          {entry.truncated && (
            <span className="text-amber-600">
              · SQL gekürzt ({entry.sql.length}/{entry.originalSqlLength} Zeichen)
            </span>
          )}
          {entry.durationMs != null && <span>· {entry.durationMs} ms</span>}
          {entry.rowCount != null && <span>· {entry.rowCount} Zeilen</span>}
          {entry.error && <span className="text-destructive">· Fehler</span>}
        </p>
      </button>
      <div className="mt-1 hidden flex-wrap gap-1 group-hover:flex group-focus-within:flex">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px]"
          onClick={() => onLoad(entry.sql, "new")}
        >
          <PlayIcon className="size-3" />
          Neuer Tab
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[11px]"
          onClick={() => onLoad(entry.sql, "replace")}
        >
          Editor ersetzen
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-[11px]"
          onClick={() => {
            useSavedQueriesStore.getState().saveQuery(firstLine(entry.sql) || "Query", entry.sql);
            toast.success("Query dauerhaft gespeichert");
          }}
        >
          Dauerhaft speichern
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
          onClick={() => undoableRemove(entry.id)}
        >
          <Trash2Icon className="size-3" />
          Löschen
        </Button>
      </div>
    </motion.div>
  );
}
