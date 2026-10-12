import { BookmarkIcon, SearchIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { SavedConnection } from "@/lib/connections";
import type { MultiTarget } from "@/lib/multi-target";
import { useMultiTargetGroups } from "@/lib/multi-target/groups";

import { MultiTargetConnectionGroup } from "./multi-target-connection-group";

interface MultiTargetPickerProps {
  connections: SavedConnection[];
  activeId: string | null;
  selected: MultiTarget[];
  onToggle: (targets: MultiTarget[], checked: boolean) => void;
  onReplace: (targets: MultiTarget[]) => void;
}

export function MultiTargetPicker({
  connections,
  activeId,
  selected,
  onToggle,
  onReplace,
}: MultiTargetPickerProps) {
  const [filter, setFilter] = useState("");
  const [groupName, setGroupName] = useState("");
  const groups = useMultiTargetGroups((state) => state.groups);
  const saveGroup = useMultiTargetGroups((state) => state.save);
  const removeGroup = useMultiTargetGroups((state) => state.remove);
  const selectedIds = new Set(selected.map((target) => target.id));
  const known = new Set(connections.map((connection) => connection.id));
  const needle = filter.trim().toLowerCase();
  return (
    <div className="flex min-h-0 w-80 shrink-0 flex-col border-r">
      <div className="space-y-2 border-b p-3">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Verbindungen, Datenbanken, Schemas filtern"
            aria-label="Ziele filtern"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-7 gap-1.5 px-2 text-xs">
                <BookmarkIcon className="size-3" />
                Gruppen
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-60">
              <DropdownMenuLabel className="text-[10px] text-muted-foreground">
                Gespeicherte Zielgruppen
              </DropdownMenuLabel>
              {groups.length === 0 && (
                <DropdownMenuItem disabled>Noch keine Gruppe gespeichert</DropdownMenuItem>
              )}
              {groups.map((group) => {
                const usable = group.targets.filter((target) => known.has(target.connectionId));
                return (
                  <DropdownMenuItem
                    key={group.id}
                    disabled={!usable.length}
                    onClick={() => onReplace(usable)}
                  >
                    <span className="flex-1 truncate">{group.name}</span>
                    <span className="text-[10px] text-muted-foreground">{usable.length}</span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      aria-label={`Gruppe ${group.name} löschen`}
                      onClick={(event) => {
                        event.stopPropagation();
                        removeGroup(group.id);
                      }}
                    >
                      <Trash2Icon className="size-3" />
                    </Button>
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
          <Input
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            placeholder="Name der Gruppe"
            aria-label="Name der Zielgruppe"
            className="h-7 min-w-0 flex-1 text-xs"
          />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            disabled={!groupName.trim() || !selected.length}
            onClick={() => {
              if (saveGroup(groupName, selected)) setGroupName("");
            }}
          >
            Speichern
          </Button>
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{selected.length} Ziele ausgewählt</span>
          <Button
            size="sm"
            variant="link"
            className="h-4 px-0 text-[11px]"
            disabled={!selected.length}
            onClick={() => onReplace([])}
          >
            Auswahl leeren
          </Button>
        </div>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto px-3">
        {connections.map((connection) => (
          <MultiTargetConnectionGroup
            key={connection.id}
            connection={connection}
            active={connection.id === activeId}
            filter={needle}
            selected={selectedIds}
            onToggle={onToggle}
          />
        ))}
      </ul>
    </div>
  );
}
