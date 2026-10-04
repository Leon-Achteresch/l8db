import { ChevronRightIcon, FolderIcon, FolderOpenIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface Props {
  name: string;
  count: number;
  depth: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function TaskListFolder({ name, count, depth, open, onToggle, children }: Props) {
  const Icon = open ? FolderOpenIcon : FolderIcon;
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="group/folder flex h-8 w-full items-center gap-1.5 rounded-lg pr-2 text-left text-xs font-medium text-muted-foreground outline-none transition-colors hover:bg-muted/70 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
        style={{ paddingLeft: `${0.25 + depth * 0.75}rem` }}
      >
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none",
            open && "rotate-90",
          )}
        />
        <Icon aria-hidden className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{count}</span>
      </button>
      {open && <div className="flex flex-col gap-px">{children}</div>}
    </div>
  );
}
