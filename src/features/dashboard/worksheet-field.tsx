import { CalendarIcon, GripVerticalIcon, HashIcon, TextIcon } from "lucide-react";
import { useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  FIELD_MIME,
  ROW_COUNT_FIELD,
  type ShelfId,
  type WorksheetField,
} from "@/lib/chart-worksheet";
import { isDateType, isNumericType } from "@/lib/dashboards";
import { cn } from "@/lib/utils";

export function WorksheetFieldItem({
  field,
  chartId,
  onPlace,
  targets,
}: {
  field: WorksheetField;
  chartId: string;
  onPlace: (field: WorksheetField, shelf?: ShelfId) => void;
  targets: { id: ShelfId; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const numeric = isNumericType(field.dataType) || field.ref === ROW_COUNT_FIELD;
  const Icon = numeric ? HashIcon : isDateType(field.dataType) ? CalendarIcon : TextIcon;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          draggable
          data-worksheet-field={field.ref}
          aria-label={`Feld ${field.label}`}
          onDragStart={(event) => {
            setOpen(false);
            event.dataTransfer.setData(
              FIELD_MIME,
              JSON.stringify({ fieldRef: field.ref, chartId }),
            );
            event.dataTransfer.effectAllowed = "copy";
          }}
          onDoubleClick={() => {
            setOpen(false);
            onPlace(field);
          }}
          className="group flex w-full cursor-grab items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted active:cursor-grabbing focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              numeric
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-blue-600 dark:text-blue-400",
            )}
          />
          <span className="min-w-0 flex-1 truncate">{field.label}</span>
          <GripVerticalIcon className="size-3 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" side="right" className="w-56 gap-1 p-1.5">
        <p className="px-2 py-1 text-xs font-medium">{field.label}</p>
        <button
          type="button"
          className="rounded px-2 py-2 text-left text-xs hover:bg-muted"
          onClick={() => {
            setOpen(false);
            onPlace(field);
          }}
        >
          Zum Chart hinzufügen
        </button>
        {targets.map((target) => (
          <button
            key={target.id}
            type="button"
            className="rounded px-2 py-2 text-left text-xs hover:bg-muted"
            onClick={() => {
              setOpen(false);
              onPlace(field, target.id);
            }}
          >
            Auf {target.label} legen
          </button>
        ))}
        {field.ref !== ROW_COUNT_FIELD && (
          <button
            type="button"
            className="rounded px-2 py-2 text-left text-xs hover:bg-muted"
            onClick={() => {
              setOpen(false);
              onPlace(field, "filters");
            }}
          >
            Als Filter verwenden
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
