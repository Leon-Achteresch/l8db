import { LayoutPanelLeftIcon, Trash2Icon } from "lucide-react";
import type * as React from "react";
import { Tooltip } from "@/components/motion/tooltip";
import { NewBadge } from "@/components/new-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SplitGroup } from "@/lib/split-view";
import { tabLabel } from "@/lib/tab-navigation";
import { cn } from "@/lib/utils";
import { iconButton } from "./constants";

interface SplitGroupsMenuProps {
  groups: SplitGroup[];
  activeGroup: string | null;
  isNew: boolean;
  triggerRef: React.Ref<HTMLButtonElement>;
  onOpen: (group: SplitGroup) => void;
  onDelete: (group: SplitGroup) => void;
}

export function SplitGroupsMenu({
  groups,
  activeGroup,
  isNew,
  triggerRef,
  onOpen,
  onDelete,
}: SplitGroupsMenuProps) {
  const label = `Tab-Gruppen (${groups.length})`;
  return (
    <DropdownMenu>
      <Tooltip content={label} side="bottom" wrapperClassName="shrink-0">
        <DropdownMenuTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label={label}
            className={`${iconButton} relative w-11 gap-0.5`}
          >
            <LayoutPanelLeftIcon className="size-3.5" />
            <span className="text-[10px] tabular-nums">{groups.length}</span>
            {isNew && <NewBadge className="absolute -top-1.5 left-6" />}
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-80 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuLabel>Tab-Gruppen</DropdownMenuLabel>
        {groups.map((group) => {
          const members = group.tabs.map((tab) => (tab ? tabLabel(tab) : "Leer")).join(" | ");
          return (
            <div key={group.id} className="flex items-center gap-0.5">
              <DropdownMenuItem
                onSelect={() => onOpen(group)}
                title={`${group.name}: ${members}`}
                aria-current={group.id === activeGroup ? "page" : undefined}
                className={cn("min-w-0 flex-1", group.id === activeGroup && "bg-primary/10")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{group.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">
                    {members}
                  </span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onDelete(group);
                }}
                aria-label={`Tab-Gruppe ${group.name} löschen`}
                className="shrink-0 text-muted-foreground"
              >
                <Trash2Icon className="size-3.5" />
              </DropdownMenuItem>
            </div>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
