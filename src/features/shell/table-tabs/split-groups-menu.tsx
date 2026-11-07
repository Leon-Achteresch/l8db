import { GlobeIcon, LayoutPanelLeftIcon, Trash2Icon } from "lucide-react";
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
import type { ForeignSplitGroup, SplitGroup } from "@/lib/split-view";
import { tabLabel } from "@/lib/tab-navigation";
import type { TemplateEntry } from "@/lib/ui-plugins/registry";
import { cn } from "@/lib/utils";
import { iconButton } from "./constants";
import { TemplateItems } from "./template-items";

interface SplitGroupsMenuProps {
  groups: SplitGroup[];
  activeGroup: string | null;
  isNew: boolean;
  triggerRef: React.Ref<HTMLButtonElement>;
  foreign: readonly ForeignSplitGroup[];
  onOpen: (group: SplitGroup, connectionId?: string) => void;
  onDelete: (group: SplitGroup, connectionId?: string) => void;
  onToggleShared: (group: SplitGroup, connectionId?: string) => void;
  sharedNew: boolean;
  sharedRef: React.Ref<HTMLDivElement>;
  templates: readonly TemplateEntry[];
  onOpenTemplate: (entry: TemplateEntry) => void;
}

export function SplitGroupsMenu({
  groups,
  activeGroup,
  isNew,
  triggerRef,
  foreign,
  onOpen,
  onDelete,
  onToggleShared,
  sharedNew,
  sharedRef,
  templates,
  onOpenTemplate,
}: SplitGroupsMenuProps) {
  const total = groups.length + foreign.length;
  const label = `Tab-Gruppen (${total})`;
  const entries = [
    ...groups.map((group) => ({ group, connectionId: undefined, connectionName: undefined })),
    ...foreign,
  ];
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
            <span className="text-[10px] tabular-nums">{total}</span>
            {isNew && <NewBadge className="absolute -top-1.5 left-6" />}
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-80 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuLabel>Tab-Gruppen</DropdownMenuLabel>
        {entries.map(({ group, connectionId, connectionName }, index) => {
          const members = group.tabs.map((tab) => (tab ? tabLabel(tab) : "Leer")).join(" | ");
          const detail = connectionName ? `${connectionName} · ${members}` : members;
          return (
            <div key={`${connectionId ?? ""}:${group.id}`} className="flex items-center gap-0.5">
              <DropdownMenuItem
                onSelect={() => onOpen(group, connectionId)}
                title={`${group.name}: ${detail}`}
                aria-current={group.id === activeGroup ? "page" : undefined}
                className={cn("min-w-0 flex-1", group.id === activeGroup && "bg-primary/10")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{group.name}</span>
                  <span className="block truncate text-[10px] text-muted-foreground">{detail}</span>
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem
                ref={index === 0 ? sharedRef : undefined}
                onSelect={(event) => {
                  event.preventDefault();
                  onToggleShared(group, connectionId);
                }}
                aria-label={
                  group.shared
                    ? `${group.name} nur für diese Verbindung`
                    : `${group.name} allgemein verfügbar machen`
                }
                aria-pressed={Boolean(group.shared)}
                title={group.shared ? "Allgemein verfügbar" : "Nur diese Verbindung"}
                className={cn(
                  "relative shrink-0",
                  group.shared ? "text-primary" : "text-muted-foreground/60",
                )}
              >
                <GlobeIcon className="size-3.5" />
                {index === 0 && sharedNew && <NewBadge className="absolute -top-1 right-0" />}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  onDelete(group, connectionId);
                }}
                aria-label={`Tab-Gruppe ${group.name} löschen`}
                className="shrink-0 text-muted-foreground"
              >
                <Trash2Icon className="size-3.5" />
              </DropdownMenuItem>
            </div>
          );
        })}
        <TemplateItems templates={templates} onOpenTemplate={onOpenTemplate} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
