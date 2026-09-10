import { motion, useReducedMotion } from "motion/react";
import { type KeyboardEvent, useId } from "react";
import { SPRING } from "@/lib/ease";
import { cn } from "@/lib/utils";

interface Props<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: string }[];
  label: string;
}

export function SegmentedControl<T extends string>({ value, onChange, options, label }: Props<T>) {
  const id = useId();
  const reduce = useReducedMotion();
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>, index: number) {
    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown")
      next = (index + 1) % options.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
      next = (index - 1 + options.length) % options.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = options.length - 1;
    else return;
    event.preventDefault();
    onChange(options[next].value);
    const buttons = event.currentTarget
      .closest('[role="radiogroup"]')
      ?.querySelectorAll<HTMLInputElement>('input[type="radio"]');
    buttons?.[next]?.focus();
  }
  return (
    <motion.div
      layoutRoot
      role="radiogroup"
      aria-label={label}
      className="flex rounded-xl bg-muted p-1"
    >
      {options.map((option, index) => (
        <label
          key={option.value}
          className={cn(
            "relative isolate flex-1 cursor-pointer rounded-lg px-3 py-[max(0.125rem,calc(0.5rem+var(--ui-density-step)))] text-center text-xs font-medium transition-colors has-focus-visible:outline-2 has-focus-visible:outline-ring has-focus-visible:outline-offset-2",
            value === option.value
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <input
            type="radio"
            name={id}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className="sr-only"
          />
          {value === option.value && (
            <motion.span
              layoutId={reduce ? undefined : id}
              transition={reduce ? { duration: 0 } : SPRING}
              className="absolute inset-0 -z-10 rounded-lg bg-card shadow-sm ring-1 ring-border/60"
            />
          )}
          {option.label}
        </label>
      ))}
    </motion.div>
  );
}
