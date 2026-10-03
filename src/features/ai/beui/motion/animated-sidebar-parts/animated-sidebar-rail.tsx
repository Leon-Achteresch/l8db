import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import {
  type AnimatedSidebarRailProps,
  useAnimatedSidebar,
  useAnimatedSidebarPanel,
} from "./shared";
export const AnimatedSidebarRail = forwardRef<HTMLButtonElement, AnimatedSidebarRailProps>(
  function AnimatedSidebarRail({ className, onClick, type = "button", ...props }, forwardedRef) {
    const context = useAnimatedSidebar();
    const panel = useAnimatedSidebarPanel();
    return (
      <button
        {...props}
        ref={forwardedRef}
        type={type}
        data-side={panel.side}
        aria-label={props["aria-label"] ?? "Toggle sidebar"}
        title="Toggle sidebar"
        tabIndex={-1}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) context.toggleSidebar();
        }}
        className={cn(
          "absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 outline-none md:block",
          "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:bg-transparent after:transition-colors hover:after:bg-border",
          "data-[side=right]:right-0 data-[side=right]:translate-x-1/2 data-[side=left]:left-full",
          className,
        )}
      />
    );
  },
);
