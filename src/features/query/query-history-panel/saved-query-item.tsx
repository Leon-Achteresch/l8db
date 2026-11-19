import { PencilIcon, PlayIcon, Trash2Icon } from "lucide-react";
import { memo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { firstLine } from "@/features/query/query-history-panel/format";
import { SavedQueryOriginLabel } from "@/features/query/saved-query-origin-label";
import type { SavedQuery } from "@/lib/saved-queries";
import type { SavedQueryOriginInfo } from "@/lib/saved-query-origin";

interface SavedQueryItemProps {
  entry: SavedQuery;
  originInfo: SavedQueryOriginInfo;
  onLoad: (sql: string, mode?: "new" | "replace") => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

export const SavedQueryItem = memo(function SavedQueryItem({
  entry,
  originInfo,
  onLoad,
  onDelete,
  onRename,
}: SavedQueryItemProps) {
  const [renaming, setRenaming] = useState(false);
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
      {renaming && (
        <Input
          autoFocus
          aria-label="Neuer Name"
          defaultValue={entry.name}
          className="h-7 text-xs"
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              event.currentTarget.value = entry.name;
              setRenaming(false);
            }
          }}
          onBlur={(event) => {
            const name = event.currentTarget.value.trim();
            if (name && name !== entry.name) onRename(entry.id, name);
            setRenaming(false);
          }}
        />
      )}
      <button
        type="button"
        className="block w-full text-left"
        onClick={() => onLoad(entry.sql, "new")}
        title="In neuem SQL-Tab öffnen"
      >
        <div className="flex min-w-0 items-center gap-2">
          {!renaming && <p className="min-w-0 flex-1 truncate text-xs font-medium">{entry.name}</p>}
          <SavedQueryOriginLabel info={originInfo} />
        </div>
        <p className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">
          {firstLine(entry.sql)}
        </p>
      </button>
      {(hovered || focused) && (
        <div className="mt-1 flex flex-wrap gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-2xs"
            onClick={() => onLoad(entry.sql, "new")}
          >
            <PlayIcon className="size-3" />
            Neuer Tab
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-2xs text-muted-foreground"
            onClick={() => setRenaming(true)}
          >
            <PencilIcon className="size-3" />
            Umbenennen
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-1.5 text-2xs text-muted-foreground"
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
