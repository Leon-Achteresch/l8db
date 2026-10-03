import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { type AnimatedSidebarCloseProps, useAnimatedSidebar } from "./shared";
export const AnimatedSidebarClose = forwardRef<HTMLButtonElement, AnimatedSidebarCloseProps>(
  function AnimatedSidebarClose({ className, onClick, type = "button", ...props }, forwardedRef) {
    const context = useAnimatedSidebar();
    return (
      <button
        {...props}
        ref={forwardedRef}
        type={type}
        aria-label={props["aria-label"] ?? "Close sidebar"}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          if (context.isMobile) context.setOpenMobile(false);
          else context.setOpen(false);
        }}
        className={cn(
          "inline-flex size-10 shrink-0 items-center justify-center rounded-xl outline-none",
          "focus-visible:ring-2 focus-visible:ring-ring",
          className,
        )}
      />
    );
  },
);
