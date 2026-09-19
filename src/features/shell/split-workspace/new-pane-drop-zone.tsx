import { useDragOperation, useDroppable } from "@dnd-kit/react";

import { MAX_SPLIT_PANES, useSplitView } from "@/lib/split-view";
import { cn } from "@/lib/utils";

export function NewPaneDropZone() {
  const { source } = useDragOperation();
  const full = useSplitView((state) => state.panes.length >= MAX_SPLIT_PANES);
  const { ref, isDropTarget } = useDroppable({ id: "pane:new", type: "pane", accept: ["tab"] });
  if (source?.type !== "tab" || full) return null;
  return (
    <div
      ref={ref}
      className={cn(
        "absolute inset-y-2 right-2 z-20 flex w-24 items-center justify-center rounded-lg border-2 border-dashed text-center text-xs transition-colors",
        isDropTarget
          ? "border-primary bg-primary/15 text-foreground"
          : "border-border bg-background/80 text-muted-foreground",
      )}
    >
      Neuer Bereich
    </div>
  );
}
