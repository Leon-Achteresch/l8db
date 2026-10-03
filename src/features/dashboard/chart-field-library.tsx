import { CalendarDaysIcon, GripVerticalIcon, HashIcon, SearchIcon, TypeIcon } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { isDateType, isNumericType } from "@/lib/dashboards";
import { cn } from "@/lib/utils";
import { CHART_FIELD_MIME, fieldTypeLabel } from "./chart-visual-builder-model";
import type { DatasetColumn } from "./use-dataset-query";

export function ChartFieldLibrary({
  columns,
  loading,
  selected,
  onSelect,
}: {
  columns: DatasetColumn[];
  loading: boolean;
  selected: string | null;
  onSelect: (field: DatasetColumn) => void;
}) {
  const [search, setSearch] = useState("");
  const found = columns.filter((field) =>
    `${field.label} ${field.type} ${fieldTypeLabel(field.type)}`
      .toLocaleLowerCase()
      .includes(search.toLocaleLowerCase()),
  );

  return (
    <aside aria-label="Verfügbare Datenfelder" className="min-w-0 rounded-xl bg-muted/35 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">Datenfelder</h3>
        <span className="text-[11px] tabular-nums text-muted-foreground">{columns.length}</span>
      </div>
      <div className="relative mb-3">
        <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
        <Input
          aria-label="Datenfelder suchen"
          placeholder="Feld suchen…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="h-9 bg-background pl-8 text-xs"
        />
      </div>
      <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
        Ziehe ein Feld nach rechts. Oder wähle es aus und klicke auf „Zuweisen“.
      </p>
      <div className="max-h-100 space-y-1 overflow-y-auto">
        {found.map((field) => {
          const Icon = isNumericType(field.type)
            ? HashIcon
            : isDateType(field.type)
              ? CalendarDaysIcon
              : TypeIcon;
          return (
            <button
              key={field.ref}
              type="button"
              draggable
              aria-pressed={selected === field.ref}
              title={`${field.label} · ${field.type}`}
              onDragStart={(event) => {
                event.dataTransfer.setData(CHART_FIELD_MIME, field.ref);
                event.dataTransfer.effectAllowed = "copy";
                onSelect(field);
              }}
              onClick={() => onSelect(field)}
              className={cn(
                "flex w-full cursor-grab items-center gap-2 rounded-lg border border-transparent px-2 py-2 text-left transition-colors hover:bg-background focus-visible:outline-2 focus-visible:outline-ring active:cursor-grabbing",
                selected === field.ref && "border-primary/25 bg-primary/5",
              )}
            >
              <Icon className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{field.label}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {fieldTypeLabel(field.type)} · {field.type}
                </span>
              </span>
              <GripVerticalIcon className="size-3 shrink-0 text-muted-foreground/50" />
            </button>
          );
        })}
        {found.length === 0 && (
          <p role="status" className="py-6 text-center text-xs text-muted-foreground">
            {loading
              ? "Felder werden geladen…"
              : search
                ? "Kein Feld gefunden."
                : "Keine Felder verfügbar."}
          </p>
        )}
      </div>
    </aside>
  );
}
