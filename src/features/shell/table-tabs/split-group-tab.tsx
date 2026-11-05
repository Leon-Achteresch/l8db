import { SquareSplitHorizontalIcon, XIcon } from "lucide-react";
import { type Ref, useRef, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";

interface SplitGroupTabProps {
  name: string;
  members: string[];
  active: boolean;
  isNew?: boolean;
  featureRef?: Ref<HTMLButtonElement>;
  onOpen: () => void;
  onRename?: (name: string) => void;
  onClose: () => void;
  onDelete?: () => void;
}

export function SplitGroupTab({
  name,
  members,
  active,
  isNew,
  featureRef,
  onOpen,
  onRename,
  onClose,
  onDelete,
}: SplitGroupTabProps) {
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  const finish = (value: string) => {
    setEditing(false);
    if (!cancelled.current) onRename?.(value);
    cancelled.current = false;
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group relative flex h-7 shrink-0 items-center rounded-md pl-1 pr-0.5 text-xs ring-1 ring-inset transition-[background-color,color] duration-200",
            active
              ? "bg-primary/12 text-foreground ring-primary/40"
              : "text-muted-foreground ring-border/80 hover:bg-card/70 hover:text-foreground",
          )}
        >
          {editing ? (
            <input
              defaultValue={name}
              aria-label="Name der Ansicht"
              ref={(element) => element?.select()}
              onBlur={(event) => finish(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key !== "Escape") return;
                cancelled.current = true;
                event.currentTarget.blur();
              }}
              className="h-5 w-32 rounded-sm bg-background px-2 text-xs outline-none ring-1 ring-ring"
            />
          ) : (
            <button
              ref={featureRef}
              type="button"
              onClick={onOpen}
              onDoubleClick={() => onRename && setEditing(true)}
              title={`${name}: ${members.join(" | ")}`}
              aria-current={active ? "page" : undefined}
              className="flex h-full min-w-0 max-w-64 items-center gap-1.5 rounded-md pr-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <span className="relative grid size-5 shrink-0 place-items-center rounded-full text-primary before:absolute before:inset-0 before:rounded-full before:bg-current before:opacity-10">
                <SquareSplitHorizontalIcon className="relative size-3" />
              </span>
              <span className="shrink-0 font-medium">{name}</span>
              <span className="truncate text-muted-foreground">{members.join(" | ")}</span>
              {isNew && <NewBadge className="shrink-0" />}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={`Geteilte Ansicht ${name} auflösen`}
            title="Geteilte Ansicht auflösen – alle Tabs bleiben geöffnet"
            className="grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground/70 opacity-0 transition-[background-color,color,opacity] duration-200 hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:opacity-100 group-focus-within:opacity-100"
          >
            <XIcon className="size-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}>Anzeigen</ContextMenuItem>
        {onRename && (
          <ContextMenuItem onSelect={() => setEditing(true)}>Umbenennen</ContextMenuItem>
        )}
        <ContextMenuItem onSelect={onClose}>Geteilte Ansicht auflösen</ContextMenuItem>
        {onDelete && <ContextMenuItem onSelect={onDelete}>Tab-Gruppe löschen</ContextMenuItem>}
      </ContextMenuContent>
    </ContextMenu>
  );
}
