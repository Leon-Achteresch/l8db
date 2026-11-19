import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { LAB_EFFORTS } from "./model-picker-data";

export function EffortSegments({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (effort: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Denkaufwand" className="flex rounded-full bg-muted p-0.5">
      {LAB_EFFORTS.map((effort) => {
        const active = effort.id === value;
        return (
          <button
            key={effort.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(effort.id)}
            className={cn(
              "relative h-6 flex-1 rounded-full px-2.5 text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
              active && "text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`effort-${id}`}
                transition={{ type: "spring", stiffness: 600, damping: 38 }}
                className="absolute inset-0 rounded-full bg-background shadow-sm"
              />
            )}
            <span className="relative">{effort.name}</span>
          </button>
        );
      })}
    </div>
  );
}
