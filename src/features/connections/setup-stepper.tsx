import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { id: 1, label: "Datenbank" },
  { id: 2, label: "Zugang" },
] as const;

interface Props {
  step: 1 | 2;
  onStep?: (step: 1 | 2) => void;
}

export function SetupStepper({ step, onStep }: Props) {
  return (
    <ol className="flex shrink-0 items-center gap-1" aria-label="Einrichtung">
      {STEPS.map((item, index) => {
        const done = step > item.id;
        const active = step === item.id;
        return (
          <li key={item.id} className="flex items-center gap-1">
            {index > 0 && <span className="h-px w-4 bg-border" />}
            <button
              type="button"
              aria-current={active ? "step" : undefined}
              disabled={!onStep || item.id > step}
              onClick={() => onStep?.(item.id)}
              className={cn(
                "flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
                active && "bg-muted font-medium text-foreground",
                done && "cursor-pointer text-foreground hover:bg-muted/60",
                !active && !done && "text-muted-foreground",
              )}
            >
              <span
                className={cn(
                  "grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums",
                  active && "bg-primary text-primary-foreground",
                  done && "bg-primary/20 text-primary",
                  !active && !done && "bg-muted text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3" /> : index + 1}
              </span>
              <span>{item.label}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
