import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StudioStep {
  id: string;
  label: string;
  detail: string;
  done: boolean;
  optional?: boolean;
}

export function StudioSteps({
  steps,
  onJump,
}: {
  steps: StudioStep[];
  onJump: (id: string) => void;
}) {
  const current = steps.find((step) => !step.done && !step.optional)?.id;
  return (
    <ol aria-label="Fortschritt" className="flex min-w-0 items-center gap-1 overflow-x-auto">
      {steps.map((step, index) => (
        <li key={step.id} className="flex shrink-0 items-center gap-1">
          {index > 0 && (
            <span
              aria-hidden="true"
              className={cn(
                "h-px w-4 transition-colors",
                steps[index - 1].done ? "bg-primary/60" : "bg-border",
              )}
            />
          )}
          <button
            type="button"
            onClick={() => onJump(step.id)}
            aria-current={current === step.id ? "step" : undefined}
            title={step.detail}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-2 py-1 text-[11px] transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring",
              step.done && "border-primary/30 text-foreground",
              !step.done && "text-muted-foreground",
              current === step.id && "border-primary bg-primary/5 text-primary",
            )}
          >
            <span
              className={cn(
                "grid size-4 place-items-center rounded-full text-[9px] font-semibold transition-colors",
                step.done ? "bg-primary text-primary-foreground" : "bg-muted",
              )}
            >
              {step.done ? <CheckIcon className="size-2.5" /> : index + 1}
            </span>
            <span className="font-medium">{step.label}</span>
            <span className="hidden max-w-28 truncate text-muted-foreground xl:inline">
              {step.detail}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}
