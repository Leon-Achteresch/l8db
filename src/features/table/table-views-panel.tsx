import { BookmarkPlusIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useActiveConnection } from "@/lib/connections";
import { useActiveDatabase } from "@/lib/db-selection";
import { tableColumnPrefKey, useTableColumnPrefs } from "@/lib/table-column-prefs";
import { tableViewStateKey, useTableViewStateStore } from "@/lib/table-view-state";
import { type SavedView, savedViewKey, useViewsStore, VIEW_COLORS } from "@/lib/views";
import { TableViewChip } from "./table-view-chip";

interface TableViewsPanelProps {
  schema: string;
  table: string;
  activeFilter: string;
  filterRaw?: boolean;
  onSelectView: (filter: string, raw?: boolean, view?: SavedView) => void;
}

export function TableViewsPanel({
  schema,
  table,
  activeFilter,
  filterRaw = false,
  onSelectView,
}: TableViewsPanelProps) {
  const connection = useActiveConnection();
  const database = useActiveDatabase();
  const tableKey = savedViewKey(connection?.id ?? "", database, schema, table);
  const legacyKey = `${schema}.${table}`;
  const legacy = useViewsStore((state) => state.views[legacyKey]);
  const savedViews = useViewsStore((s) => s.views[tableKey]) ?? [];
  const addView = useViewsStore((s) => s.addView);
  const removeView = useViewsStore((s) => s.removeView);

  const [saveOpen, setSaveOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSave = () => {
    if (!newName.trim()) return;
    const color = VIEW_COLORS[savedViews.length % VIEW_COLORS.length];
    const key = tableViewStateKey(connection?.id, database, schema, table);
    const state = key ? useTableViewStateStore.getState().views[key] : undefined;
    const layoutKey = connection
      ? tableColumnPrefKey(connection.id, schema, table, database)
      : undefined;
    const layout = layoutKey ? useTableColumnPrefs.getState().prefs[layoutKey] : undefined;
    addView(tableKey, {
      name: newName.trim(),
      filter: activeFilter,
      filterRaw,
      color,
      state,
      layout,
    });
    setSaveOpen(false);
    setNewName("");
  };

  const nextColor = VIEW_COLORS[savedViews.length % VIEW_COLORS.length];

  return (
    <div className="flex shrink-0 items-center gap-0.5 overflow-x-auto border-b bg-background px-3 py-1.5 [scrollbar-width:thin]">
      <TableViewChip
        schema={schema}
        table={table}
        label="Alle"
        filter=""
        color="#6b7280"
        active={activeFilter === ""}
        onSelect={() => onSelectView("")}
      />

      {savedViews.map((view: SavedView) => (
        <TableViewChip
          key={view.id}
          schema={schema}
          table={table}
          label={view.name}
          filter={view.filter}
          filterRaw={view.filterRaw}
          color={view.color}
          active={activeFilter !== "" && activeFilter === view.filter}
          onSelect={() => onSelectView(view.filter, view.filterRaw, view)}
          onRemove={() => {
            removeView(tableKey, view.id);
            toast("Ansicht entfernt", {
              action: {
                label: "Rückgängig",
                onClick: () =>
                  useViewsStore.setState((state) => ({
                    views: { ...state.views, [tableKey]: [...(state.views[tableKey] ?? []), view] },
                  })),
              },
            });
          }}
        />
      ))}

      {Boolean(legacy?.length) && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            for (const view of legacy ?? []) {
              if (
                !savedViews.some(
                  (saved) => saved.name === view.name && saved.filter === view.filter,
                )
              )
                addView(tableKey, {
                  name: view.name,
                  filter: view.filter,
                  color: view.color,
                  filterRaw: view.filterRaw,
                });
            }
            toast.success("Alte Filter dieser Verbindung zugeordnet");
          }}
          title="Filter aus älteren Versionen besitzen keine Verbindungszuordnung. Hier bewusst für diese Tabelle übernehmen."
        >
          Alte Filter übernehmen ({legacy?.length})
        </Button>
      )}
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
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-1 shrink-0"
            title="Filter, Sortierung und Spalten als Ansicht speichern"
          >
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
