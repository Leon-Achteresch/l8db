import { ChevronDown } from "lucide-react";
import { type ReactNode, useState } from "react";
import { cn } from "@/lib/utils";

export function RecommendationCard({
  title,
  children,
  icon,
  meta,
  details,
  detailsLabel = "Details",
  defaultOpen = false,
  actions,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
  meta?: ReactNode;
  details?: ReactNode;
  detailsLabel?: string;
  defaultOpen?: boolean;
  actions: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={cn(
        "w-full rounded-2xl bg-card p-3.5 text-card-foreground shadow-[0_1px_2px_oklch(0_0_0/5%),0_8px_24px_-12px_oklch(0_0_0/16%)] animate-in fade-in slide-in-from-bottom-1 duration-300",
        className,
      )}
    >
      <div className="flex items-start gap-2.5">
        {icon && (
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400 [&_svg]:size-3.5">
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug">{title}</p>
          {meta && (
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
              {meta}
            </div>
          )}
        </div>
      </div>
      {children && (
        <div className="mt-3 text-xs leading-relaxed break-words text-muted-foreground">
          {children}
        </div>
      )}
      {details && (
        <div
          className="grid transition-[grid-template-rows,opacity] duration-300 ease-smooth-out"
          style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
        >
          <div inert={!open} className="overflow-hidden">
            <div className="mt-2 rounded-xl bg-muted/60 px-3 py-2.5">{details}</div>
          </div>
        </div>
      )}
      <div className="mt-3 flex items-center gap-1.5">
        {details && (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="-ml-1 flex h-7 items-center gap-1 rounded-md px-1 text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            {detailsLabel}
            <ChevronDown
              className={cn("size-3 transition-transform duration-200", open && "rotate-180")}
            />
          </button>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">{actions}</div>
      </div>
    </div>
  );
}
