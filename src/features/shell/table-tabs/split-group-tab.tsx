import { SquareSplitHorizontalIcon, XIcon } from "lucide-react";
import { useRef, useState } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { SplitGroup } from "@/lib/split-view";
import { tabLabel } from "@/lib/tab-navigation";

interface SplitGroupTabProps {
  group: SplitGroup;
  onOpen: () => void;
  onRename: (name: string) => void;
  onClose: () => void;
  onDelete: () => void;
}

export function SplitGroupTab({ group, onOpen, onRename, onClose, onDelete }: SplitGroupTabProps) {
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const members = group.tabs.map((tab) => (tab ? tabLabel(tab) : "Leer"));
  const finish = (value: string) => {
    setEditing(false);
    if (!cancelled.current) onRename(value);
    cancelled.current = false;
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className="group relative flex h-7 shrink-0 items-center rounded-full bg-primary/12 pl-1 pr-0.5 text-xs text-foreground ring-1 ring-primary/40 ring-inset transition-[background-color,color] duration-200">
          {editing ? (
            <input
              defaultValue={group.name}
              aria-label="Name der Ansicht"
              ref={(element) => element?.select()}
              onBlur={(event) => finish(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key !== "Escape") return;
                cancelled.current = true;
                event.currentTarget.blur();
              }}
              className="h-5 w-32 rounded-full bg-background px-2 text-xs outline-none ring-1 ring-ring"
            />
          ) : (
            <button
              type="button"
              onClick={onOpen}
              onDoubleClick={() => setEditing(true)}
              title={`${group.name}: ${members.join(" | ")}`}
              aria-current="page"
              className="flex h-full min-w-0 max-w-64 items-center gap-1.5 rounded-full pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="relative grid size-5 shrink-0 place-items-center rounded-full text-primary before:absolute before:inset-0 before:rounded-full before:bg-current before:opacity-10">
                <SquareSplitHorizontalIcon className="relative size-3" />
              </span>
              <span className="shrink-0 font-medium">{group.name}</span>
              <span className="truncate text-muted-foreground">{members.join(" | ")}</span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={`Tab-Gruppe ${group.name} schließen`}
            className="grid size-7 shrink-0 place-items-center rounded-full text-muted-foreground/70 opacity-0 transition-[background-color,color,opacity] duration-200 hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}>Öffnen</ContextMenuItem>
        <ContextMenuItem onSelect={() => setEditing(true)}>Umbenennen</ContextMenuItem>
        <ContextMenuItem onSelect={onClose}>Tab-Gruppe schließen</ContextMenuItem>
        <ContextMenuItem onSelect={onDelete}>Tab-Gruppe löschen</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
