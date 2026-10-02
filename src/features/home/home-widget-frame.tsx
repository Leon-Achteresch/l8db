import { GripVertical, X } from "lucide-react";
import type { ReactNode } from "react";
import { IconButton } from "@/components/icon-button";
import { cn } from "@/lib/utils";

export function HomeWidgetFrame({
  label,
  editing,
  onRemove,
  children,
}: {
  label: string;
  editing: boolean;
  onRemove: () => void;
  children: ReactNode;
}) {
  return (
    <div className={cn("relative h-full", editing && "cursor-grab active:cursor-grabbing")}>
      <div className="h-full" inert={editing}>
        {children}
      </div>
      {editing && (
        <>
          <div className="pointer-events-none absolute inset-0 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/[0.04]" />
          <div className="absolute right-2 top-2 z-10 flex items-center gap-1 rounded-lg border bg-popover py-0.5 pl-1.5 pr-0.5 shadow-sm">
            <GripVertical className="size-3.5 text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">{label}</span>
            <IconButton
              variant="ghost"
              size="icon-xs"
              className="home-widget-control"
              aria-label={`${label} entfernen`}
              onClick={onRemove}
            >
              <X />
            </IconButton>
          </div>
        </>
      )}
    </div>
  );
}
