import { Check } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { SPRING } from "@/lib/ease";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: 1, label: "Datenbank" },
  { id: 2, label: "Zugang" },
  { id: 3, label: "Prüfen" },
] as const;

interface Props {
  step: 1 | 2 | 3;
  onStep?: (step: 1 | 2 | 3) => void;
}

export function SetupStepper({ step, onStep }: Props) {
  const reduce = useReducedMotion();
  return (
    <ol className="grid grid-cols-3 gap-2" aria-label="Einrichtung">
      {STEPS.map((item, index) => {
        const done = step > item.id;
        const active = step === item.id;
        return (
          <li key={item.id}>
            <motion.button
              type="button"
              layout
              transition={{ layout: SPRING }}
              disabled={!onStep || item.id > step}
              onClick={() => onStep?.(item.id)}
              className={cn(
                "relative flex w-full items-center gap-2.5 rounded-2xl px-3 py-2.5 text-left transition-[transform,background-color] duration-200",
                active && "bg-primary/12 ring-2 ring-primary/40",
                done && "bg-card/80",
                !active && !done && "bg-muted/50 text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold",
                  active && "bg-primary text-primary-foreground",
                  done && "bg-primary/20 text-primary",
                  !active && !done && "bg-background text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold">{item.label}</span>
                <span className="block text-[11px] text-muted-foreground">
                  {done ? "Fertig" : active ? "Jetzt" : "Als Nächstes"}
                </span>
              </span>
              {active && (
                <motion.span
                  layoutId={reduce ? undefined : "setup-step"}
                  transition={SPRING}
                  className="pointer-events-none absolute inset-0 rounded-2xl ring-2 ring-primary/30"
                />
              )}
            </motion.button>
          </li>
        );
      })}
    </ol>
  );
}
