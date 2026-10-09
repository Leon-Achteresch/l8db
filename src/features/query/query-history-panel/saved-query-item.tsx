import { PlayIcon, Trash2Icon } from "lucide-react";
import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { firstLine } from "@/features/query/query-history-panel/format";
import type { SavedQuery } from "@/lib/saved-queries";

interface SavedQueryItemProps {
  entry: SavedQuery;
  onLoad: (sql: string, mode?: "new" | "replace") => void;
  onDelete: (id: string) => void;
}

export const SavedQueryItem = memo(function SavedQueryItem({
  entry,
  onLoad,
  onDelete,
}: SavedQueryItemProps) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <fieldset
      className="group min-w-0 px-3 py-2 hover:bg-muted/40"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
      }}
    >
      <button
        type="button"
        className="block w-full text-left"
        onClick={() => onLoad(entry.sql, "new")}
        title="In neuem SQL-Tab öffnen"
      >
        <p className="truncate text-xs font-medium">{entry.name}</p>
        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
          {firstLine(entry.sql)}
        </p>
      </button>
      {(hovered || focused) && (
        <div className="mt-1 flex flex-wrap gap-1">
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
            className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground"
            onClick={() => onDelete(entry.id)}
          >
            <Trash2Icon className="size-3" />
            Löschen
          </Button>
        </div>
      )}
    </fieldset>
  );
});
