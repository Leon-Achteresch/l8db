import { CheckIcon, PlusIcon, Trash2Icon, XIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
} from "@/components/ui/popover";
import { createId, emptyCondition } from "@/features/table/table-filter-panel/filter-conditions";
import type { DetailedColumnInfo } from "@/lib/db";
import { activeRuleConditions, ROW_RULE_COLORS } from "@/lib/row-rules";
import type { RowRule } from "@/lib/table-view-state";
import { cn } from "@/lib/utils";
import { FilterConditionFields } from "./filter-condition-fields";

export function RuleEditorPopover({
  rule,
  columns,
  columnDetails,
  orSupported,
  defaultColor,
  onSave,
  onRemove,
  children,
}: {
  rule?: RowRule;
  columns: string[];
  columnDetails?: DetailedColumnInfo[];
  orSupported: boolean;
  defaultColor: string;
  onSave: (rule: RowRule) => void;
  onRemove?: () => void;
  children: (open: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<RowRule>(() => ({
    id: createId(),
    color: defaultColor,
    combinator: "AND",
    conditions: [emptyCondition(columns[0] ?? "")],
  }));

  const show = () => {
    setDraft(
      rule
        ? { ...rule, conditions: rule.conditions.map((condition) => ({ ...condition })) }
        : {
            id: createId(),
            color: defaultColor,
            combinator: "AND",
            conditions: [emptyCondition(columns[0] ?? "")],
          },
    );
    setError("");
    setOpen(true);
  };

  const save = () => {
    const conditions = activeRuleConditions(draft.conditions);
    if (!conditions.length) {
      setError("Mindestens eine vollständige Bedingung angeben.");
      return;
    }
    onSave({ ...draft, combinator: orSupported ? draft.combinator : "AND", conditions });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverAnchor asChild>{children(show)}</PopoverAnchor>
      <PopoverContent align="end" className="w-[min(26rem,calc(100vw-2rem))] gap-3 p-3">
        <PopoverHeader>
          <PopoverTitle>{rule ? "Farbregel bearbeiten" : "Neue Farbregel"}</PopoverTitle>
          <PopoverDescription>
            Passende Zeilen werden farbig hinterlegt. Es wird nichts ausgeblendet.
          </PopoverDescription>
        </PopoverHeader>
        <fieldset
          aria-label="Farbe"
          className="m-0 flex flex-wrap items-center gap-1.5 border-0 p-0"
        >
          {ROW_RULE_COLORS.map((color) => (
            <button
              key={color.value}
              type="button"
              aria-pressed={draft.color === color.value}
              aria-label={color.label}
              title={color.label}
              onClick={() => setDraft((current) => ({ ...current, color: color.value }))}
              className={cn(
                "grid size-6 place-items-center rounded-full text-white outline-none focus-visible:ring-2 focus-visible:ring-ring",
                draft.color === color.value &&
                  "ring-2 ring-foreground/40 ring-offset-1 ring-offset-background",
              )}
              style={{ backgroundColor: color.value }}
            >
              {draft.color === color.value ? <CheckIcon className="size-3.5" /> : null}
            </button>
          ))}
          <input
            type="color"
            value={draft.color}
            onChange={(event) => setDraft((current) => ({ ...current, color: event.target.value }))}
            aria-label="Eigene Farbe"
            title="Eigene Farbe"
            className="size-6 cursor-pointer rounded-full border-0 bg-transparent p-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
          />
        </fieldset>
        <div className="grid gap-2">
          {draft.conditions.map((condition, index) => (
            <div key={condition.id} className="grid gap-2">
              {index > 0 ? (
                <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  <span className="h-px flex-1 bg-border" />
                  {orSupported ? (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          combinator: current.combinator === "AND" ? "OR" : "AND",
                        }))
                      }
                      className="rounded-md bg-muted px-1.5 py-0.5 font-medium uppercase text-foreground hover:bg-muted/70"
                      title="Zwischen „und“ und „oder“ wechseln"
                    >
                      {draft.combinator === "OR" ? "oder" : "und"}
                    </button>
                  ) : (
                    <span className="font-medium uppercase">und</span>
                  )}
                  <span className="h-px flex-1 bg-border" />
                </div>
              ) : null}
              <div className="flex items-start gap-1">
                <div className="min-w-0 flex-1">
                  <FilterConditionFields
                    condition={condition}
                    columns={columns}
                    columnDetails={columnDetails}
                    onChange={(patch) => {
                      setError("");
                      setDraft((current) => ({
                        ...current,
                        conditions: current.conditions.map((entry) =>
                          entry.id === condition.id ? { ...entry, ...patch } : entry,
                        ),
                      }));
                    }}
                    onSubmit={save}
                  />
                </div>
                {draft.conditions.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Bedingung entfernen"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        conditions: current.conditions.filter((entry) => entry.id !== condition.id),
                      }))
                    }
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="justify-self-start text-muted-foreground"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                conditions: [...current.conditions, emptyCondition(columns[0] ?? "")],
              }))
            }
          >
            <PlusIcon />
            Bedingung
          </Button>
        </div>
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
            <span
              aria-hidden
              className="size-2.5 rounded-full ring-1 ring-primary-foreground/50"
              style={{ backgroundColor: draft.color }}
            />
            {rule ? "Speichern" : "Regel hinzufügen"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
