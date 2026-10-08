import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface OnboardingChoiceProps {
  group: string;
  index: number;
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  children: ReactNode;
}

export function OnboardingChoice({
  group,
  selected,
  onSelect,
  title,
  description,
  children,
}: OnboardingChoiceProps) {
  return (
    <button
      type="button"
      data-choice-group={group}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        "relative flex flex-col gap-3 rounded-lg border bg-card p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        selected ? "border-primary ring-1 ring-primary" : "border-border hover:border-primary/40",
      )}
    >
      {children}
      <div className="px-0.5">
        <p className="flex items-center justify-between gap-2 text-sm font-medium">
          {title}
          {selected && <Check aria-hidden="true" className="size-3.5 shrink-0 text-primary" />}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
    </button>
  );
}
