import { BookmarkPlusIcon, XIcon } from "lucide-react";
import { motion } from "motion/react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTableRowCountQuery } from "@/lib/queries";
import { SPRING_LAYOUT } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { type SavedView, useViewsStore, VIEW_COLORS } from "@/lib/views";

function formatCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(count);
}

interface ViewChipProps {
  schema: string;
  table: string;
  label: string;
  filter: string;
  color: string;
  active: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}

function ViewChip({
  schema,
  table,
  label,
  filter,
  color,
  active,
  onSelect,
  onRemove,
}: ViewChipProps) {
  const countQuery = useTableRowCountQuery(schema, table, filter);

  return (
    <motion.button
      type="button"
      layout
      transition={{ layout: SPRING_LAYOUT }}
      onClick={onSelect}
      className={cn(
        "group flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-sm transition-colors",
        active
          ? "border border-border bg-background shadow-xs"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className={active ? "font-medium text-foreground" : ""}>{label}</span>
      {countQuery.data !== undefined && (
        <span className="text-xs text-muted-foreground">{formatCount(countQuery.data)}</span>
      )}
      {onRemove && (
        <span
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 hidden rounded-sm opacity-60 hover:opacity-100 group-hover:inline-flex"
        >
          <XIcon className="size-3" />
        </span>
      )}
    </motion.button>
  );
}

interface TableViewsPanelProps {
  schema: string;
  table: string;
  activeFilter: string;
  onSelectView: (filter: string) => void;
}

export function TableViewsPanel({
  schema,
  table,
  activeFilter,
  onSelectView,
}: TableViewsPanelProps) {
  const tableKey = `${schema}.${table}`;
  const savedViews = useViewsStore((s) => s.views[tableKey]) ?? [];
  const addView = useViewsStore((s) => s.addView);
  const removeView = useViewsStore((s) => s.removeView);

  const [saveOpen, setSaveOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    if (!newName.trim()) return;
    const color = VIEW_COLORS[savedViews.length % VIEW_COLORS.length];
    addView(tableKey, { name: newName.trim(), filter: activeFilter, color });
    setSaveOpen(false);
    setNewName("");
  };

  const nextColor = VIEW_COLORS[savedViews.length % VIEW_COLORS.length];

  return (
    <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-background px-3 py-1.5 [scrollbar-width:thin]">
      <ViewChip
        schema={schema}
        table={table}
        label="Alle"
        filter=""
        color="#6b7280"
        active={activeFilter === ""}
        onSelect={() => onSelectView("")}
      />

      {savedViews.map((view: SavedView) => (
        <ViewChip
          key={view.id}
          schema={schema}
          table={table}
          label={view.name}
          filter={view.filter}
          color={view.color}
          active={activeFilter !== "" && activeFilter === view.filter}
          onSelect={() => onSelectView(view.filter)}
          onRemove={() => removeView(tableKey, view.id)}
        />
      ))}

      <Popover
        open={saveOpen}
        onOpenChange={(open) => {
          setSaveOpen(open);
          if (open) {
            setNewName("");
            setTimeout(() => inputRef.current?.focus(), 0);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="ml-1 shrink-0" title="View speichern">
            <BookmarkPlusIcon className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 gap-0 p-3" align="start">
          <div className="mb-2 flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: nextColor }} />
            <span className="text-xs text-muted-foreground">
              {activeFilter.trim() === "" ? "Aktuell kein Filter aktiv" : activeFilter}
            </span>
          </div>
          <Input
            ref={inputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
            }}
            placeholder="View-Name"
            className="mb-2 h-8"
          />
          <Button size="sm" className="w-full" onClick={handleSave} disabled={!newName.trim()}>
            Speichern
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
