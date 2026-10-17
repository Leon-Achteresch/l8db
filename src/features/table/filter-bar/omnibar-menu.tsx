import { Columns3Icon, FilterIcon, InfoIcon, SparklesIcon } from "lucide-react";
import { Fragment } from "react";
import { IS_MAC } from "@/lib/platform";
import { ROW_RULE_COLORS } from "@/lib/row-rules";
import { cn } from "@/lib/utils";
import { OmnibarMenuItem } from "./omnibar-menu-item";

export type OmnibarItem =
  | { id: string; kind: "column"; column: string }
  | { id: "add" | "rule" | "ai"; kind: "add" | "rule" | "ai" };

export function OmnibarMenu({
  listId,
  items,
  activeIndex,
  text,
  preview,
  hint,
  ruleColor,
  onRuleColor,
  onPick,
  onHover,
}: {
  listId: string;
  items: OmnibarItem[];
  activeIndex: number;
  text: string;
  preview: string;
  hint: string;
  ruleColor: string;
  onRuleColor: (color: string) => void;
  onPick: (item: OmnibarItem) => void;
  onHover: (index: number) => void;
}) {
  return (
    <div id={listId} role="listbox" aria-label="Vorschläge" className="grid gap-0.5">
      {items.map((item, index) => (
        <Fragment key={item.id}>
          {index === 0 && item.kind === "column" ? (
            <div className="px-2 pt-1 pb-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              Spalten
            </div>
          ) : null}
          {index > 0 && item.kind !== "column" && items[index - 1].kind === "column" ? (
            <div aria-hidden className="mx-1 my-0.5 h-px bg-border" />
          ) : null}
          {item.kind === "column" ? (
            <OmnibarMenuItem
              id={`${listId}-${index}`}
              active={index === activeIndex}
              icon={<Columns3Icon className="size-3.5" />}
              label={item.column}
              shortcut={index === activeIndex ? "⇥" : undefined}
              onSelect={() => onPick(item)}
              onHover={() => onHover(index)}
            />
          ) : item.kind === "add" ? (
            <OmnibarMenuItem
              id={`${listId}-${index}`}
              active={index === activeIndex}
              icon={<FilterIcon className="size-3.5" />}
              label="Filter hinzufügen"
              detail={preview}
              shortcut="↵"
              onSelect={() => onPick(item)}
              onHover={() => onHover(index)}
            />
          ) : item.kind === "rule" ? (
            <OmnibarMenuItem
              id={`${listId}-${index}`}
              active={index === activeIndex}
              icon={
                <span className="size-2.5 rounded-full" style={{ backgroundColor: ruleColor }} />
              }
              label="Als Farbregel markieren"
              shortcut="⇧↵"
              onSelect={() => onPick(item)}
              onHover={() => onHover(index)}
            >
              <span className="flex shrink-0 items-center gap-1">
                {ROW_RULE_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    aria-label={`Farbe ${color.label}`}
                    aria-pressed={ruleColor === color.value}
                    title={color.label}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => {
                      event.stopPropagation();
                      onRuleColor(color.value);
                    }}
                    className={cn(
                      "size-3 rounded-full outline-none",
                      ruleColor === color.value &&
                        "ring-2 ring-foreground/50 ring-offset-1 ring-offset-popover",
                    )}
                    style={{ backgroundColor: color.value }}
                  />
                ))}
              </span>
            </OmnibarMenuItem>
          ) : (
            <OmnibarMenuItem
              id={`${listId}-${index}`}
              active={index === activeIndex}
              icon={<SparklesIcon className="size-3.5 text-violet-500" />}
              label="Mit KI filtern"
              detail={`„${text}“`}
              shortcut={IS_MAC ? "⌘↵" : "Strg+↵"}
              onSelect={() => onPick(item)}
              onHover={() => onHover(index)}
            />
          )}
        </Fragment>
      ))}
      {hint ? (
        <div className="flex items-start gap-2 px-2 py-1.5 text-xs text-muted-foreground">
          <InfoIcon className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0">{hint}</span>
        </div>
      ) : null}
    </div>
  );
}
