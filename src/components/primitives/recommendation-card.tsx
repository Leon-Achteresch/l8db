import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function RecommendationCard({
  title,
  children,
  meta,
  details,
  detailsLabel = "Details",
  defaultOpen = false,
  actions,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
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
        "w-full overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs animate-in fade-in slide-in-from-bottom-1 duration-300",
        className,
      )}
    >
      <div className="px-3.5 pt-3 pb-3">
        <p className="text-[13px] font-medium leading-snug">{title}</p>
        {children && (
          <div className="mt-1.5 text-xs leading-relaxed break-words text-muted-foreground">
            {children}
          </div>
        )}
      </div>
      {details && (
        <div
          className="grid transition-[grid-template-rows,opacity] duration-300 ease-smooth-out"
          style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}
        >
          <div inert={!open} className="overflow-hidden">
            <div className="border-t bg-muted/20 px-3.5 py-2.5">{details}</div>
          </div>
        </div>
      )}
      <div className="flex items-center justify-between gap-3 border-t bg-muted/30 px-2.5 py-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          {meta}
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {details && (
            <Button size="xs" variant="ghost" aria-expanded={open} onClick={() => setOpen(!open)}>
              {detailsLabel}
            </Button>
          )}
          {actions}
        </div>
      </div>
    </div>
  );
}
