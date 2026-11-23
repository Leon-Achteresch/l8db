import { motion } from "motion/react";
import { cn } from "@/lib/utils";
import { LAB_EFFORTS } from "./model-picker-data";

export function EffortSlider({
  value,
  onChange,
}: {
  value: string;
  onChange: (effort: string) => void;
}) {
  const index = Math.max(
    0,
    LAB_EFFORTS.findIndex((effort) => effort.id === value),
  );
  const ratio = index / (LAB_EFFORTS.length - 1);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between text-[11px]">
        <span className="text-muted-foreground">Denkaufwand</span>
        <motion.span
          key={value}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          className="font-medium"
        >
          {LAB_EFFORTS[index].name}
        </motion.span>
      </div>
      <div
        role="slider"
        tabIndex={0}
        aria-label="Denkaufwand"
        aria-valuemin={0}
        aria-valuemax={LAB_EFFORTS.length - 1}
        aria-valuenow={index}
        aria-valuetext={LAB_EFFORTS[index].name}
        onKeyDown={(event) => {
          const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
          const next = LAB_EFFORTS[index + step];
          if (step && next) {
            event.preventDefault();
            onChange(next.id);
          }
        }}
        className="relative h-5 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="absolute inset-x-2 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted">
          <motion.div
            className="h-full rounded-full bg-foreground/70"
            animate={{ width: `${ratio * 100}%` }}
            transition={{ type: "spring", stiffness: 400, damping: 32 }}
          />
        </div>
        <div className="absolute inset-x-2 inset-y-0">
          {LAB_EFFORTS.map((effort, stop) => (
            <button
              key={effort.id}
              type="button"
              tabIndex={-1}
              aria-label={effort.name}
              onClick={() => onChange(effort.id)}
              style={{ left: `${(stop / (LAB_EFFORTS.length - 1)) * 100}%` }}
              className="absolute top-1/2 grid size-5 -translate-x-1/2 -translate-y-1/2 place-items-center"
            >
              <span
                className={cn(
                  "size-1.5 rounded-full bg-muted-foreground/30",
                  stop <= index && "bg-background",
                )}
              />
            </button>
          ))}
          <motion.span
            className="pointer-events-none absolute top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground shadow"
            animate={{ left: `${ratio * 100}%` }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          />
        </div>
      </div>
    </div>
  );
}
