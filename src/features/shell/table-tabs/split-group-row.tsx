import {
  ArrowRightLeftIcon,
  GlobeIcon,
  LayersIcon,
  PencilIcon,
  RefreshCwIcon,
  SquareSplitHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import type * as React from "react";
import { useRef } from "react";
import { NewBadge } from "@/components/new-badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { groupPaneTabs, isTabSet, type SplitGroup } from "@/lib/split-view";
import { tabLabel } from "@/lib/tab-navigation";
import { cn } from "@/lib/utils";

interface SplitGroupRowProps {
  group: SplitGroup;
  connectionName?: string;
  active: boolean;
  editing: boolean;
  canSave: boolean;
  hold?: Pick<React.ComponentProps<typeof DropdownMenuItem>, "onPointerMove" | "onPointerLeave">;
  sharedRef?: React.Ref<HTMLDivElement>;
  sharedNew?: boolean;
  onOpen: () => void;
  onSwitch?: () => void;
  onOverwrite?: () => void;
  onEdit?: (editing: boolean) => void;
  onRename?: (name: string) => void;
  onToggleShared: () => void;
  onDelete: () => void;
}

const action =
  "shrink-0 text-muted-foreground opacity-0 transition-opacity duration-150 focus:opacity-100 group-hover/row:opacity-100 group-focus-within/row:opacity-100";

function focusName(element: HTMLInputElement | null) {
  element?.focus();
  element?.select();
}

function members(group: SplitGroup): string {
  const lists = groupPaneTabs(group);
  if (isTabSet(group)) return lists.flat().map(tabLabel).join(", ");
  return group.tabs
    .map((tab, index) => {
      const more = (lists[index]?.length ?? 0) - 1;
      return tab ? tabLabel(tab) + (more > 0 ? ` +${more}` : "") : "Leer";
    })
    .join(" | ");
}

export function SplitGroupRow({
  group,
  connectionName,
  active,
  editing,
  canSave,
  hold,
  sharedRef,
  sharedNew,
  onOpen,
  onSwitch,
  onOverwrite,
  onEdit,
  onRename,
  onToggleShared,
  onDelete,
}: SplitGroupRowProps) {
  const cancelled = useRef(false);
  const detail = members(group);
  const Icon = isTabSet(group) ? LayersIcon : SquareSplitHorizontalIcon;

  if (editing)
    return (
      <div className="flex items-center gap-2 py-1 pr-1.5 pl-2.5">
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={focusName}
          defaultValue={group.name}
          aria-label="Name der Tab-Gruppe"
          maxLength={80}
          onBlur={(event) => {
            if (!cancelled.current) onRename?.(event.currentTarget.value);
            cancelled.current = false;
            onEdit?.(false);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key !== "Escape") return;
            cancelled.current = true;
            event.currentTarget.blur();
          }}
          className="h-7 min-w-0 flex-1 rounded-full bg-background px-3 text-[13px] text-foreground outline-none ring-1 ring-ring"
        />
      </div>
    );

  return (
    <div className="group/row flex items-center gap-0.5">
      <DropdownMenuItem
        {...hold}
        onSelect={onOpen}
        title={`${group.name}: ${connectionName ? `${connectionName} · ${detail}` : detail}`}
        aria-current={active ? "page" : undefined}
        className={cn("min-w-0 flex-1", active && "bg-primary/10")}
      >
        <Icon className="size-3.5 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{group.name}</span>
          <span className="block truncate text-[10px] text-muted-foreground">{detail}</span>
        </span>
      </DropdownMenuItem>
      {onSwitch && (
        <DropdownMenuItem
          {...hold}
          onSelect={onSwitch}
          aria-label={`${group.name} in ${connectionName} öffnen`}
          title={`Zu ${connectionName} wechseln`}
          className={action}
        >
          <ArrowRightLeftIcon className="size-3.5" />
        </DropdownMenuItem>
      )}
      {onOverwrite && (
        <DropdownMenuItem
          {...hold}
          disabled={!canSave}
          onSelect={(event) => {
            event.preventDefault();
            onOverwrite();
          }}
          aria-label={`${group.name} mit den offenen Tabs überschreiben`}
          title="Mit offenen Tabs überschreiben"
          className={action}
        >
          <RefreshCwIcon className="size-3.5" />
        </DropdownMenuItem>
      )}
      {onEdit && (
        <DropdownMenuItem
          {...hold}
          onSelect={(event) => {
            event.preventDefault();
            onEdit(true);
          }}
          aria-label={`${group.name} umbenennen`}
          title="Umbenennen"
          className={action}
        >
          <PencilIcon className="size-3.5" />
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        {...hold}
        ref={sharedRef}
        onSelect={(event) => {
          event.preventDefault();
          onToggleShared();
        }}
        aria-label={
          group.shared
            ? `${group.name} nur für diese Verbindung`
            : `${group.name} allgemein verfügbar machen`
        }
        aria-pressed={Boolean(group.shared)}
        title={group.shared ? "Allgemein verfügbar" : "Nur diese Verbindung"}
        className={cn(action, "relative", group.shared && "text-primary opacity-100")}
      >
        <GlobeIcon className="size-3.5" />
        {sharedNew && <NewBadge className="absolute -top-1 right-0" />}
      </DropdownMenuItem>
      <DropdownMenuItem
        {...hold}
        onSelect={(event) => {
          event.preventDefault();
          onDelete();
        }}
        aria-label={`Tab-Gruppe ${group.name} löschen`}
        title="Löschen"
        className={action}
      >
        <Trash2Icon className="size-3.5" />
      </DropdownMenuItem>
    </div>
  );
}
