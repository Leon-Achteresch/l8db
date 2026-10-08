import { Ellipsis } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface SidebarNavItem {
  id: string;
  label: string;
  icon?: ReactNode;
}

export function SidebarNavRow({
  item,
  active,
  disabled,
  onPick,
  onRename,
  menu,
}: {
  item: SidebarNavItem;
  active: boolean;
  disabled?: boolean;
  onPick: (id: string) => void;
  onRename?: (id: string, label: string) => void;
  menu?: (item: SidebarNavItem, rename: () => void) => ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const renaming = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);
  const commit = (value: string) => {
    setEditing(false);
    if (value.trim() && value.trim() !== item.label) onRename?.(item.id, value.trim());
  };
  if (editing)
    return (
      <div data-row className="relative flex h-8 items-center gap-2 rounded-md bg-muted px-2">
        {item.icon}
        <input
          defaultValue={item.label}
          aria-label="Gespräch umbenennen"
          ref={input}
          onBlur={(event) => commit(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit(event.currentTarget.value);
            if (event.key === "Escape") setEditing(false);
          }}
          className="min-w-0 flex-1 bg-transparent text-xs outline-none"
        />
      </div>
    );
  return (
    <div data-row className="group/nav-row relative flex h-8 items-center rounded-md">
      <button
        type="button"
        title={item.label}
        aria-current={active ? "page" : undefined}
        disabled={disabled}
        onClick={() => onPick(item.id)}
        onDoubleClick={() => onRename && !disabled && setEditing(true)}
        className={cn(
          "flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-xs outline-none transition-[color,transform] duration-150 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default",
          active
            ? "bg-muted font-medium text-foreground"
            : "text-foreground/75 hover:text-foreground",
          menu && "pr-8",
        )}
      >
        {item.icon}
        <span className="min-w-0 flex-1 truncate">{item.label}</span>
      </button>
      {menu && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`Aktionen für ${item.label}`}
              className="absolute right-1 flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[opacity,background-color] hover:bg-background/70 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring group-hover/nav-row:opacity-100 data-[state=open]:opacity-100 pointer-coarse:opacity-100"
            >
              <Ellipsis className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            className="w-48 rounded-xl text-xs"
            onCloseAutoFocus={(event) => {
              if (!renaming.current) return;
              renaming.current = false;
              event.preventDefault();
            }}
          >
            {menu(item, () => {
              renaming.current = true;
              setEditing(true);
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
