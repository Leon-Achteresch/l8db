import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { SharedLayoutBg } from "../shared-layout-bg";
export const AnimatedSidebarMenu = forwardRef<HTMLUListElement, HTMLAttributes<HTMLUListElement>>(
  function AnimatedSidebarMenu({ children, className, ...props }, forwardedRef) {
    return (
      <SharedLayoutBg
        {...props}
        ref={forwardedRef as React.Ref<HTMLElement>}
        as="ul"
        inset={0}
        pillClassName="rounded-xl bg-muted/70"
        pillContainerClassName="inset-y-auto top-0 h-9"
        data-slot="sidebar-menu"
        className={cn("flex w-full min-w-0 list-none flex-col gap-0.5", className)}
      >
        {children}
      </SharedLayoutBg>
    );
  },
);
