import * as React from "react";
import { cn } from "@/lib/utils";

export function ContextMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        "ml-auto pl-6 text-xs text-muted-foreground group-focus/context-menu-item:opacity-75",
        className,
      )}
      {...props}
    />
  );
}
