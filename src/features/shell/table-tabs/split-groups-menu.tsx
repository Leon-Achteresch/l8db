import { ChevronDownIcon, CodeIcon, PlusIcon } from "lucide-react";
import type * as React from "react";
import { Fragment, useState } from "react";
import { Tooltip } from "@/components/motion/tooltip";
import { NewBadge } from "@/components/new-badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { type ForeignSplitGroup, isTabSet, type SplitGroup } from "@/lib/split-view";
import { iconButton } from "./constants";
import { SplitGroupRow } from "./split-group-row";

interface SplitGroupsMenuProps {
  groups: SplitGroup[];
  activeGroup: string | null;
  canSave: boolean;
  isNew: boolean;
  triggerRef: React.Ref<HTMLButtonElement>;
  foreign: readonly ForeignSplitGroup[];
  onNewQuery: () => void;
  onOpen: (group: SplitGroup, connectionId?: string) => void;
  onSwitch: (group: SplitGroup, connectionId: string) => void;
  onSave: (group?: SplitGroup) => string | null;
  onRename: (group: SplitGroup, name: string) => void;
  onDelete: (group: SplitGroup, connectionId?: string) => void;
  onToggleShared: (group: SplitGroup, connectionId?: string) => void;
  sharedNew: boolean;
  sharedRef: React.Ref<HTMLDivElement>;
}

const prevent = (event: React.PointerEvent) => event.preventDefault();
const HOLD = { onPointerMove: prevent, onPointerLeave: prevent };

export function SplitGroupsMenu({
  groups,
  activeGroup,
  canSave,
  isNew,
  triggerRef,
  foreign,
  onNewQuery,
  onOpen,
  onSwitch,
  onSave,
  onRename,
  onDelete,
  onToggleShared,
  sharedNew,
  sharedRef,
}: SplitGroupsMenuProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const saveFeature = useNewFeatureVisibility<HTMLDivElement>("split.saved-views.tab-sets");
  const menuFeature = useNewFeatureVisibility<HTMLDivElement>("split.saved-views.plus-menu");
  const total = groups.length + foreign.length;
  const label = total ? `Tab-Gruppen (${total})` : "Tab-Gruppen";
  const hold = editing ? HOLD : undefined;
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) return;
        if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur();
        setEditing(null);
      }}
    >
      <Tooltip content="Abfrage oder Ansicht öffnen" side="bottom" wrapperClassName="shrink-0">
        <DropdownMenuTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            aria-label={label}
            className={`${iconButton} relative w-6 rounded-l-none text-primary hover:bg-primary/15 hover:text-primary`}
          >
            <ChevronDownIcon className="size-3.5" />
            {isNew && <NewBadge className="absolute -top-1.5 left-3" />}
          </button>
        </DropdownMenuTrigger>
      </Tooltip>
      <DropdownMenuContent
        align="end"
        onEscapeKeyDown={(event) => editing && event.preventDefault()}
        className="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] w-80 max-w-[calc(100vw-2rem)]"
      >
        <DropdownMenuItem {...hold} ref={menuFeature.ref} onSelect={onNewQuery}>
          <CodeIcon className="size-3.5 text-muted-foreground" />
          <span className="flex-1">Neue Abfrage</span>
          {menuFeature.isNew && <NewBadge />}
        </DropdownMenuItem>
        <DropdownMenuItem
          {...hold}
          ref={saveFeature.ref}
          disabled={!canSave}
          onSelect={(event) => {
            event.preventDefault();
            const id = onSave();
            if (id) setEditing(id);
          }}
        >
          <PlusIcon className="size-3.5 text-muted-foreground" />
          <span className="flex-1">Offene Tabs als Gruppe speichern</span>
          {saveFeature.isNew && <NewBadge />}
        </DropdownMenuItem>
        {groups.length > 0 && <DropdownMenuSeparator />}
        {groups.map((group, index) => (
          <SplitGroupRow
            key={group.id}
            group={group}
            active={group.id === activeGroup}
            editing={editing === group.id}
            canSave={canSave}
            hold={hold}
            sharedRef={index === 0 ? sharedRef : undefined}
            sharedNew={index === 0 && sharedNew}
            onOpen={() => onOpen(group)}
            onOverwrite={isTabSet(group) ? () => onSave(group) : undefined}
            onEdit={(open) => setEditing(open ? group.id : null)}
            onRename={(name) => onRename(group, name)}
            onToggleShared={() => onToggleShared(group)}
            onDelete={() => onDelete(group)}
          />
        ))}
        {foreign.map(({ group, connectionId, connectionName }, index) => (
          <Fragment key={`${connectionId}:${group.id}`}>
            {foreign[index - 1]?.connectionId !== connectionId && (
              <DropdownMenuLabel className="truncate">{connectionName}</DropdownMenuLabel>
            )}
            <SplitGroupRow
              group={group}
              connectionName={connectionName}
              active={false}
              editing={false}
              canSave={false}
              hold={hold}
              onOpen={() => onOpen(group, connectionId)}
              onSwitch={() => onSwitch(group, connectionId)}
              onToggleShared={() => onToggleShared(group, connectionId)}
              onDelete={() => onDelete(group, connectionId)}
            />
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
