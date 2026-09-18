import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import type { CommandItem } from "./types";

export function CommandPaletteOption({
  item,
  index,
  isActive,
  uid,
  reduce,
  hasIcons,
  onHover,
  onSelect,
}: {
  item: CommandItem;
  index: number;
  isActive: boolean;
  uid: string;
  reduce: boolean | null;
  hasIcons: boolean;
  onHover: () => void;
  onSelect: () => void;
}) {
  const Icon = item.icon;
  return (
    <button
      type="button"
      id={`${uid}-opt-${index}`}
      role="option"
      aria-selected={isActive}
      data-index={index}
      onMouseEnter={onHover}
      onClick={onSelect}
      className={cn(
        "relative isolate flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-sm transition-colors",
        isActive ? "text-foreground" : "text-muted-foreground",
      )}
    >
      {isActive ? (
        <motion.span
          layoutId={`${uid}-active`}
          className="absolute inset-0 z-0 rounded-md bg-primary/[0.05]"
          transition={
            reduce
              ? { duration: 0 }
              : // Tracks rapid arrow-key navigation — keep it tighter
                // than SPRING_LAYOUT so it never lags the active row.
                {
                  type: "spring",
                  stiffness: 480,
                  damping: 38,
                }
          }
        />
      ) : null}
      {Icon ? (
        <Icon className="relative z-10 h-4 w-4" />
      ) : hasIcons ? (
        <span className="relative z-10 h-4 w-4" />
      ) : null}
      <span className="relative z-10 flex-1 truncate">{item.label}</span>
      {item.badge ? <span className="relative z-10 shrink-0">{item.badge}</span> : null}
      {item.hint ? (
        <kbd className="relative z-10 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
          {item.hint}
        </kbd>
      ) : null}
    </button>
  );
}
