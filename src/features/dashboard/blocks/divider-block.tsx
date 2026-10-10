import type { WidgetBlock } from "@/lib/dashboards";
import { cn } from "@/lib/utils";

export function DividerBlock({ block }: { block: WidgetBlock }) {
  return (
    <div className="flex h-full items-center gap-3">
      {block.align !== "left" && block.text && <div className="h-px flex-1 bg-border" />}
      {block.text && (
        <span
          className={cn(
            "dashboard-block-divider-label shrink-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase",
          )}
        >
          {block.text}
        </span>
      )}
      {block.align !== "right" && <div className="h-px flex-1 bg-border" />}
    </div>
  );
}
