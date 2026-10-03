import { Check } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

const EASE = [0.22, 1, 0.36, 1] as const;

interface Props {
  steps: string[];
  current: number;
}
export function AiOnboardingStepper({ steps, current }: Props) {
  return (
    <ol aria-label="Einrichtungsschritte" className="flex items-center gap-2">
      {steps.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li
            key={label}
            aria-current={active ? "step" : undefined}
            className={cn("flex items-center gap-2", index < steps.length - 1 && "flex-1")}
          >
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "relative grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-medium tabular-nums transition-[background-color,border-color,color] duration-300 ease-smooth-out",
                  done && "border-primary bg-primary text-primary-foreground",
                  active && "border-primary text-primary",
                  !done && !active && "border-border text-muted-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="ai-onboarding-step"
                    className="absolute -inset-1 rounded-full bg-primary/10"
                    transition={{ duration: 0.35, ease: EASE }}
                  />
                )}
                {done ? <Check className="size-3.5" /> : index + 1}
              </span>
              <span
                className={cn(
                  "hidden text-xs whitespace-nowrap transition-colors duration-300 @md:inline",
                  active ? "font-medium text-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </span>
            {index < steps.length - 1 && (
              <span className="relative h-px min-w-4 flex-1 overflow-hidden rounded-full bg-border">
                <motion.span
                  className="absolute inset-0 origin-left bg-primary"
                  initial={false}
                  animate={{ transform: `scaleX(${done ? 1 : 0})` }}
                  transition={{ duration: 0.4, ease: EASE }}
                />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
