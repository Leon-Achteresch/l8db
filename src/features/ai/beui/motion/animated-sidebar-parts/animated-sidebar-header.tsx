import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
export const AnimatedSidebarHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AnimatedSidebarHeader({ className, ...props }, forwardedRef) {
    return (
      <div
        {...props}
        ref={forwardedRef}
        data-slot="sidebar-header"
        className={cn("flex shrink-0 flex-col gap-2 p-3", className)}
      />
    );
  },
);
