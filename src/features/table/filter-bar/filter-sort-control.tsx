import type { SortingState } from "@tanstack/react-table";
import { ArrowDownIcon, ArrowUpDownIcon, ArrowUpIcon, XIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSettingsStore } from "@/lib/settings";

export interface FilterBarSort {
  sorting: SortingState;
  sortableColumns?: string[];
  onChange: (sorting: SortingState) => void;
}

const SEGMENT =
  "flex h-full min-w-0 items-center px-2 outline-none transition-colors hover:bg-foreground/5 focus-visible:bg-foreground/10";

export function FilterSortControl({
  sort,
  columns,
  showLabel = true,
}: {
  sort?: FilterBarSort;
  columns: string[];
  showLabel?: boolean;
}) {
  const enabled = useSettingsStore((state) => state.filterBarSorting);
  const [open, setOpen] = useState(false);
  const [draftDesc, setDraftDesc] = useState(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const sortable = sort?.sortableColumns;
  const shown = enabled && Boolean(sort);
  const options = useMemo(() => {
    if (!shown) return [];
    if (!sortable) return columns;
    const allowed = new Set(sortable);
    return columns.filter((column) => allowed.has(column));
  }, [shown, columns, sortable]);
  const active = sort?.sorting[0];
  if (!shown || !sort || (!active && options.length === 0)) return null;
  const desc = active ? Boolean(active.desc) : draftDesc;
  const toggle = () => setOpen((value) => !value);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <span ref={anchorRef} className="inline-flex min-w-0 shrink-0">
          {active ? (
            <span
              data-filter-token="sort"
              className="inline-flex h-6 max-w-full items-stretch overflow-hidden rounded-md border border-input bg-background/60 text-xs"
            >
              <button
                type="button"
                aria-label={
                  active.desc
                    ? `Absteigend nach ${active.id} – aufsteigend sortieren`
                    : `Aufsteigend nach ${active.id} – absteigend sortieren`
                }
                title="Richtung umkehren"
                onClick={() => sort.onChange([{ id: active.id, desc: !active.desc }])}
                className={`${SEGMENT} text-muted-foreground hover:text-foreground`}
              >
                {active.desc ? (
                  <ArrowDownIcon className="size-3" />
                ) : (
                  <ArrowUpIcon className="size-3" />
                )}
              </button>
              <button
                type="button"
                aria-label={`Sortierung ändern: ${active.id}`}
                title="Sortierung ändern"
                onClick={toggle}
                className={`${SEGMENT} border-l border-border/70`}
              >
                <span className="max-w-52 truncate">{active.id}</span>
              </button>
              <button
                type="button"
                aria-label={`Sortierung entfernen: ${active.id}`}
                onClick={() => {
                  setOpen(false);
                  sort.onChange([]);
                }}
                className="flex items-center border-l border-border/70 px-1.5 text-muted-foreground outline-none transition-colors hover:bg-foreground/5 hover:text-foreground focus-visible:bg-foreground/10 focus-visible:text-foreground"
              >
                <XIcon className="size-3" />
              </button>
            </span>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size={showLabel ? "xs" : "icon-xs"}
              className="shrink-0 text-muted-foreground"
              aria-label="Sortierung hinzufügen"
              title="Zeilen sortieren"
              onClick={toggle}
            >
              <ArrowUpDownIcon />
              {showLabel ? "Sortierung" : null}
            </Button>
          )}
        </span>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[min(18rem,calc(100vw-2rem))] gap-2 p-3"
        onInteractOutside={(event) => {
          if (anchorRef.current?.contains(event.target as Node)) event.preventDefault();
        }}
      >
        <Select
          value={active?.id ?? ""}
          onValueChange={(id) => {
            sort.onChange([{ id, desc }]);
            setDraftDesc(false);
          }}
        >
          <SelectTrigger size="sm" className="w-full min-w-0" aria-label="Sortierspalte">
            <SelectValue placeholder="Spalte wählen …" />
          </SelectTrigger>
          <SelectContent position="popper" searchable>
            {options.map((column) => (
              <SelectItem key={column} value={column}>
                {column}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SegmentedControl
          value={desc ? "desc" : "asc"}
          onChange={(value) => {
            const next = value === "desc";
            if (active) sort.onChange([{ id: active.id, desc: next }]);
            else setDraftDesc(next);
          }}
          label="Sortierrichtung"
          options={[
            { value: "asc", label: "Aufsteigend" },
            { value: "desc", label: "Absteigend" },
          ]}
        />
      </PopoverContent>
    </Popover>
  );
}
