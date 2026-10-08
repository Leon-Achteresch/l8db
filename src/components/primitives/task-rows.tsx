import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";
import { type TaskStatus, TaskStatusIcon } from "./task-status-icon";

export interface TaskRow {
  id: string;
  label: ReactNode;
  status: TaskStatus;
  meta?: ReactNode;
  details?: ReactNode;
}

const PILL: Partial<Record<TaskStatus, [string, string]>> = {
  failed: ["Fehlgeschlagen", "bg-destructive/10 text-destructive"],
  cancelled: ["Abgebrochen", "bg-muted text-muted-foreground"],
};

export function TaskRows({
  rows,
  title,
  defaultOpen,
  className,
}: {
  rows: TaskRow[];
  title?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  const done = rows.filter((row) => row.status === "done").length;
  const [open, setOpen] = useState(defaultOpen ?? done < rows.length);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const listOpen = !title || open;
  return (
    <div
      className={cn(
        "w-full overflow-hidden rounded-xl border bg-card text-card-foreground",
        className,
      )}
    >
      {title && (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex h-9 w-full items-center gap-2 px-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {done}/{rows.length}
          </span>
          <ChevronDown
            className={cn(
              "size-3.5 text-muted-foreground transition-transform duration-300",
              open && "rotate-180",
            )}
          />
        </button>
      )}
      <div
        className="grid transition-[grid-template-rows,opacity] duration-300 ease-smooth-out"
        style={{ gridTemplateRows: listOpen ? "1fr" : "0fr", opacity: listOpen ? 1 : 0 }}
      >
        <ol inert={!listOpen} className={cn("overflow-hidden", title && "border-t")}>
          {rows.map((row, index) => {
            const rowOpen = Boolean(expanded[row.id]);
            const pill = PILL[row.status];
            return (
              <li
                key={row.id}
                className="border-b animate-in fade-in slide-in-from-bottom-1 fill-mode-both duration-300 last:border-0"
                style={{ animationDelay: `${index * 60}ms` }}
              >
                <button
                  type="button"
                  disabled={!row.details}
                  aria-expanded={row.details ? rowOpen : undefined}
                  onClick={() => setExpanded((all) => ({ ...all, [row.id]: !rowOpen }))}
                  className="flex min-h-9 w-full items-center gap-2.5 px-3 py-1.5 text-left outline-none transition-colors enabled:hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset disabled:cursor-default"
                >
                  <TaskStatusIcon status={row.status} step={index + 1} />
                  <span
                    className={cn(
                      "min-w-0 flex-1 text-xs leading-relaxed",
                      row.status === "done" || row.status === "cancelled"
                        ? "text-muted-foreground"
                        : "text-foreground",
                    )}
                  >
                    {row.label}
                  </span>
                  {row.meta && (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {row.meta}
                    </span>
                  )}
                  {pill && (
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-medium animate-in fade-in",
                        pill[1],
                      )}
                    >
                      {pill[0]}
                    </span>
                  )}
                  {row.details && (
                    <ChevronDown
                      className={cn(
                        "size-3.5 shrink-0 text-muted-foreground transition-transform duration-300",
                        rowOpen && "rotate-180",
                      )}
                    />
                  )}
                </button>
                {row.details && (
                  <div
                    className="grid transition-[grid-template-rows,opacity] duration-300 ease-smooth-out"
                    style={{ gridTemplateRows: rowOpen ? "1fr" : "0fr", opacity: rowOpen ? 1 : 0 }}
                  >
                    <div inert={!rowOpen} className="overflow-hidden">
                      <div className="ml-[22px] border-l px-3 pb-2.5 text-xs text-muted-foreground">
                        {row.details}
                      </div>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
