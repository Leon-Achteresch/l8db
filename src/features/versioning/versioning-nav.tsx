import { ChevronDownIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { VersioningArea } from "@/lib/versioning/workflow";
import { VERSIONING_SECTIONS } from "./versioning-sections";

export function VersioningNav({
  section,
  deploys,
  counts,
  fresh,
  disabled,
  onNavigate,
}: {
  section: VersioningArea;
  deploys: boolean;
  counts: Partial<Record<VersioningArea, string | number>>;
  fresh: Partial<Record<VersioningArea, boolean>>;
  disabled: boolean;
  onNavigate: (area: VersioningArea) => void;
}) {
  const visible = VERSIONING_SECTIONS.filter((entry) => deploys || !entry.deploy);
  const tools = visible.filter((entry) => entry.tool);
  const activeTool = tools.find((entry) => entry.id === section);
  return (
    <nav
      aria-label="Bereiche"
      className="flex h-9 shrink-0 items-stretch gap-0.5 overflow-x-auto border-b border-border/60 px-2"
    >
      <div role="tablist" aria-label="Bereiche" className="flex items-stretch gap-0.5">
        {visible
          .filter((entry) => !entry.tool)
          .map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="tab"
              disabled={disabled}
              aria-selected={section === id}
              onClick={() => onNavigate(id)}
              className={cn(
                "relative flex shrink-0 items-center gap-1.5 px-2.5 text-xs transition-colors disabled:opacity-50",
                section === id
                  ? "font-medium text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              {label}
              {counts[id] !== undefined && counts[id] !== 0 && (
                <span className="font-mono text-[10px] text-muted-foreground tabular-nums">
                  {counts[id]}
                </span>
              )}
              {fresh[id] && section !== id && <NewBadge />}
            </button>
          ))}
      </div>
      {tools.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={disabled}
              className={cn(
                "relative ml-auto flex shrink-0 items-center gap-1 px-2.5 text-xs transition-colors disabled:opacity-50",
                activeTool
                  ? "font-medium text-foreground after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {activeTool?.label ?? "Werkzeuge"}
              <ChevronDownIcon className="size-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {tools.map(({ id, label, icon: Icon }) => (
              <DropdownMenuItem key={id} onSelect={() => onNavigate(id)}>
                <Icon />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </nav>
  );
}
