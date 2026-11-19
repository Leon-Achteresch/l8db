import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { useAnimatedSidebarPanel } from "./shared";
export const AnimatedSidebarGroupLabel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function AnimatedSidebarGroupLabel({ children, className, ...props }, forwardedRef) {
    const { collapsed } = useAnimatedSidebarPanel();
    return (
      <div
        {...props}
        ref={forwardedRef}
        aria-hidden={collapsed}
        data-slot="sidebar-group-label"
        className={cn(
          "mb-1 h-7 overflow-hidden px-2 text-2xs font-medium text-muted-foreground transition-opacity",
          collapsed ? "opacity-0" : "opacity-100",
          className,
        )}
      >
        {children}
      </div>
    );
  },
);
