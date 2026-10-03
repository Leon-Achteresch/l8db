import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { type AnimatedSidebarTriggerProps, useAnimatedSidebar } from "./shared";
export const AnimatedSidebarTrigger = forwardRef<HTMLButtonElement, AnimatedSidebarTriggerProps>(
  function AnimatedSidebarTrigger({ className, onClick, type = "button", ...props }, forwardedRef) {
    const context = useAnimatedSidebar();
    const expanded = context.isMobile ? context.openMobile : context.open;
    return (
      <button
        {...props}
        ref={(node) => {
          context.triggerRef.current = node;
          if (typeof forwardedRef === "function") forwardedRef(node);
          else if (forwardedRef) forwardedRef.current = node;
        }}
        type={type}
        aria-label={props["aria-label"] ?? "Toggle sidebar"}
        aria-expanded={expanded}
        data-slot="sidebar-trigger"
        data-state={expanded ? "expanded" : "collapsed"}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) context.toggleSidebar();
        }}
        className={cn(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-xl outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          className,
        )}
      />
    );
  },
);
