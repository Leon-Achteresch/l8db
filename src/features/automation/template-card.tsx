import { ArrowRightIcon, CalendarClockIcon, ListOrderedIcon } from "lucide-react";
import { useMemo } from "react";
import type { TaskTemplate } from "@/lib/automation/templates";
import { cn } from "@/lib/utils";

interface Props {
  template: TaskTemplate;
  onPick: (template: TaskTemplate) => void;
  className?: string;
}

export function TemplateCard({ template, onPick, className }: Props) {
  const facts = useMemo(() => {
    try {
      const task = template.build();
      return { steps: task.steps.length, scheduled: task.schedules.length > 0 };
    } catch {
      return null;
    }
  }, [template]);

  return (
    <button
      type="button"
      data-template-id={template.id}
      onClick={() => onPick(template)}
      className={cn(
        "group/template flex h-full flex-col gap-2 rounded-xl border bg-card p-3.5 text-left shadow-xs outline-none transition-[background-color,border-color,box-shadow,transform] duration-150 ease-out",
        "hover:border-primary/30 hover:bg-accent/40 focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.99]",
        className,
      )}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-[13px] leading-snug font-semibold text-balance">{template.name}</span>
        <ArrowRightIcon
          aria-hidden
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/template:translate-x-0.5 group-hover/template:opacity-100 group-focus-visible/template:opacity-100 motion-reduce:transition-none"
        />
      </span>
      <span className="line-clamp-3 text-xs leading-relaxed text-pretty text-muted-foreground">
        {template.description}
      </span>
      {facts && (
        <span className="mt-auto flex items-center gap-3 pt-1 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ListOrderedIcon aria-hidden className="size-3" />
            {facts.steps === 1 ? "1 Schritt" : `${facts.steps} Schritte`}
          </span>
          <span className="inline-flex items-center gap-1">
            <CalendarClockIcon aria-hidden className="size-3" />
            {facts.scheduled ? "Mit Zeitplan" : "Manuell"}
          </span>
        </span>
      )}
    </button>
  );
}
