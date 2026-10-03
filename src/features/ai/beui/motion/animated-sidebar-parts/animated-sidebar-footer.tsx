import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
export const AnimatedSidebarFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AnimatedSidebarFooter({ className, ...props }, forwardedRef) {
    return (
      <div
        {...props}
        ref={forwardedRef}
        data-slot="sidebar-footer"
        className={cn(
          "flex shrink-0 flex-col gap-2 border-border border-t p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]",
          className,
        )}
      />
    );
  },
);
