import { FilePenLineIcon } from "lucide-react";

interface Props {
  name: string;
}

export function TaskListDraftItem({ name }: Props) {
  return (
    <div
      data-task-draft
      data-active
      aria-current="true"
      className="mb-px flex min-h-11 items-center gap-2 rounded-lg bg-accent pr-1.5 pl-2 animate-in duration-150 fade-in-0"
    >
      <span className="flex size-4 shrink-0 items-center justify-center text-primary">
        <FilePenLineIcon className="size-3.5" aria-hidden />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5 py-1.5">
        <span className="truncate text-[13px] font-medium" title={name || undefined}>
          {name || "Neuer Task"}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          Entwurf · nicht gespeichert
        </span>
      </span>
    </div>
  );
}
