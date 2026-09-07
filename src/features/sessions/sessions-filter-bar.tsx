import { FilterXIcon, LayersIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  EMPTY_SESSION_FILTERS,
  isSessionFilterActive,
  type SessionFilters,
  type SessionGrouping,
} from "@/lib/session-filters";

const ALL_STATES = "__all__";

interface SessionsFilterBarProps {
  filters: SessionFilters;
  onFiltersChange: (filters: SessionFilters) => void;
  states: string[];
  grouping: SessionGrouping;
  onGroupingChange: (grouping: SessionGrouping) => void;
  shown: number;
  total: number;
  groupCount: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

export function SessionsFilterBar({
  filters,
  onFiltersChange,
  states,
  grouping,
  onGroupingChange,
  shown,
  total,
  groupCount,
  onExpandAll,
  onCollapseAll,
}: SessionsFilterBarProps) {
  const active = isSessionFilterActive(filters);
  const update = (patch: Partial<SessionFilters>) => onFiltersChange({ ...filters, ...patch });

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      <Input
        value={filters.user}
        onChange={(e) => update({ user: e.target.value })}
        placeholder="Benutzer"
        className="h-8 w-32 text-xs"
        aria-label="Nach Benutzer filtern"
      />
      <Input
        value={filters.application}
        onChange={(e) => update({ application: e.target.value })}
        placeholder="Anwendung"
        className="h-8 w-36 text-xs"
        aria-label="Nach Anwendung filtern"
      />
      <Select
        value={filters.state || ALL_STATES}
        onValueChange={(value) => update({ state: value === ALL_STATES ? "" : value })}
      >
        <SelectTrigger className="h-8 w-32 text-xs" aria-label="Nach Status filtern">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_STATES}>Alle Status</SelectItem>
          {states.map((state) => (
            <SelectItem key={state} value={state}>
              {state}
            </SelectItem>
          ))}
          {filters.state && !states.includes(filters.state) && (
            <SelectItem value={filters.state}>{filters.state}</SelectItem>
          )}
        </SelectContent>
      </Select>
      <Input
        value={filters.query}
        onChange={(e) => update({ query: e.target.value })}
        placeholder="Query enthält…"
        className="h-8 min-w-40 flex-1 font-mono text-xs"
        aria-label="Nach Query-Text filtern"
      />
      <Button
        variant="ghost"
        size="sm"
        className="h-8 gap-1 px-2 text-xs"
        disabled={!active}
        onClick={() => onFiltersChange(EMPTY_SESSION_FILTERS)}
      >
        <FilterXIcon className="size-3.5" />
        Zurücksetzen
      </Button>
      <span className="text-xs tabular-nums text-muted-foreground">
        {active ? `${shown} von ${total}` : `${total}`} Sitzungen
      </span>
      <span className="mx-1 h-5 w-px bg-border" />
      <LayersIcon className="size-3.5 text-muted-foreground" />
      <Select
        value={grouping}
        onValueChange={(value) => onGroupingChange(value as SessionGrouping)}
      >
        <SelectTrigger className="h-8 w-40 text-xs" aria-label="Gruppierung">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="none">Keine Gruppierung</SelectItem>
          <SelectItem value="user">Nach Benutzer</SelectItem>
          <SelectItem value="application">Nach Anwendung</SelectItem>
        </SelectContent>
      </Select>
      {grouping !== "none" && (
        <>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={onExpandAll}>
            Alle auf
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={onCollapseAll}
            disabled={groupCount === 0}
          >
            Alle zu
          </Button>
        </>
      )}
    </div>
  );
}
