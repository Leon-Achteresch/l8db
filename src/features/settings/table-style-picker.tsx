import { CheckIcon } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useId } from "react";
import { TableStylePreview } from "@/features/settings/table-style-preview";
import { SPRING_LAYOUT } from "@/lib/ease";
import { TABLE_STYLES, type TableStyle } from "@/lib/table-style";
import { cn } from "@/lib/utils";

type Props = {
  value: TableStyle;
  onChange: (value: TableStyle) => void;
};

export function TableStylePicker({ value, onChange }: Props) {
  const name = useId();
  const reduce = useReducedMotion();
  return (
    <div
      role="radiogroup"
      aria-label="Tabellenstil"
      className="grid w-full grid-cols-1 gap-3 @min-[30rem]:grid-cols-2 @min-[56rem]:grid-cols-4"
    >
      {TABLE_STYLES.map((option) => {
        const selected = option.value === value;
        return (
          <label
            key={option.value}
            data-table-style={option.value}
            className={cn(
              "group/style relative flex cursor-pointer flex-col gap-2.5 rounded-xl border bg-card p-2 transition-[border-color,box-shadow,translate] duration-200 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/60",
              selected
                ? "border-primary/60 shadow-sm"
                : "border-border hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-sm",
            )}
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={selected}
              onChange={() => onChange(option.value)}
              className="sr-only"
            />
            {selected ? (
              <motion.span
                layoutId={`${name}-selected`}
                transition={reduce ? { duration: 0 } : SPRING_LAYOUT}
                className="pointer-events-none absolute -inset-px rounded-xl ring-2 ring-primary"
              />
            ) : null}
            <div
              className={cn(
                "overflow-hidden rounded-lg border border-border/70 transition-opacity",
                !selected && "opacity-85 group-hover/style:opacity-100",
              )}
            >
              <TableStylePreview style={option.value} />
            </div>
            <div className="flex items-start gap-2 px-1 pb-0.5">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{option.label}</div>
                <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
                  {option.description}
                </p>
              </div>
              <span
                className={cn(
                  "mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border transition-colors",
                  selected
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-muted-foreground/40",
                )}
              >
                {selected ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
              </span>
            </div>
          </label>
        );
      })}
    </div>
  );
}
