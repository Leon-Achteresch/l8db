import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
export const AnimatedSidebarContent = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AnimatedSidebarContent({ className, ...props }, forwardedRef) {
    return (
      <div
        {...props}
        ref={forwardedRef}
        data-slot="sidebar-content"
        className={cn(
          "flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden overscroll-contain px-2 py-2",
          className,
        )}
      />
    );
  },
);
