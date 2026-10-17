import { Trash2Icon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { emptyCondition } from "@/features/table/table-filter-panel/filter-conditions";
import type { DetailedColumnInfo } from "@/lib/db";
import { operatorNeedsValue } from "@/lib/sql-filter";
import type { FilterCondition } from "@/lib/table-view-state";
import { FilterConditionFields } from "./filter-condition-fields";
import type { FilterTokenPart } from "./filter-token";

export function FilterConditionPopover({
  condition,
  columns,
  columnDetails,
  title,
  onSave,
  onRemove,
  children,
}: {
  condition?: FilterCondition;
  columns: string[];
  columnDetails?: DetailedColumnInfo[];
  title: string;
  onSave: (condition: FilterCondition) => string;
  onRemove?: () => void;
  children: (open: (part: FilterTokenPart) => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [focusValue, setFocusValue] = useState(false);
  const [draft, setDraft] = useState<FilterCondition>(() => emptyCondition(columns[0] ?? ""));
  const [error, setError] = useState("");

  const show = (part: FilterTokenPart) => {
    setDraft(condition ? { ...condition } : emptyCondition(columns[0] ?? ""));
    setFocusValue(part === "value" && Boolean(condition?.column));
    setError("");
    setOpen(true);
  };

  const save = () => {
    if (!draft.column) {
      setError("Bitte eine Spalte wählen.");
      return;
    }
    if (operatorNeedsValue(draft.operator) && draft.value.trim() === "") {
      setError("Bitte einen Wert eingeben.");
      return;
    }
    const message = onSave(draft);
    if (message) {
      setError(message);
      return;
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>{children(show)}</PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[min(26rem,calc(100vw-2rem))] gap-3 p-3"
        onOpenAutoFocus={(event) => {
          if (focusValue) event.preventDefault();
        }}
      >
        <div className="text-xs font-medium text-muted-foreground">{title}</div>
        <FilterConditionFields
          condition={draft}
          columns={columns}
          columnDetails={columnDetails}
          focusValue={focusValue}
          onChange={(patch) => {
            setError("");
            setDraft((current) => ({ ...current, ...patch }));
          }}
          onSubmit={save}
        />
        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex items-center gap-2">
          {onRemove ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                setOpen(false);
                onRemove();
              }}
            >
              <Trash2Icon />
              Entfernen
            </Button>
          ) : null}
          <span className="flex-1" />
          <Button type="button" size="sm" onClick={save}>
            {condition ? "Übernehmen" : "Hinzufügen"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
