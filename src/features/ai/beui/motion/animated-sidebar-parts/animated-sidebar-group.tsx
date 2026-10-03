import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
export const AnimatedSidebarGroup = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AnimatedSidebarGroup({ className, ...props }, forwardedRef) {
    return (
      <div
        {...props}
        ref={forwardedRef}
        data-slot="sidebar-group"
        className={cn("flex w-full min-w-0 flex-col px-1 py-1.5", className)}
      />
    );
  },
);
