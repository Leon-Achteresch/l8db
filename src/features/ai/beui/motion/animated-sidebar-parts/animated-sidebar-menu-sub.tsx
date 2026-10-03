import { AnimatePresence, motion } from "motion/react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import {
  type AnimatedSidebarMenuSubProps,
  SUBMENU_VARIANTS,
  useAnimatedSidebar,
  useAnimatedSidebarPanel,
} from "./shared";
export const AnimatedSidebarMenuSub = forwardRef<HTMLUListElement, AnimatedSidebarMenuSubProps>(
  function AnimatedSidebarMenuSub({ open, children, className, ...props }, forwardedRef) {
    const context = useAnimatedSidebar();
    const panel = useAnimatedSidebarPanel();
    return (
      <AnimatePresence initial={false} mode="popLayout">
        {open && !panel.collapsed ? (
          <motion.ul
            {...props}
            ref={forwardedRef}
            key="sidebar-submenu"
            variants={context.reduce ? undefined : SUBMENU_VARIANTS}
            initial={context.reduce ? false : "closed"}
            animate={context.reduce ? { opacity: 1 } : "open"}
            exit={context.reduce ? { opacity: 0 } : "closed"}
            transition={context.reduce ? { duration: 0.12 } : undefined}
            data-slot="sidebar-menu-sub"
            className={cn(
              "relative mt-1 ml-5 flex min-w-0 flex-col gap-0.5 border-border border-l pl-3",
              className,
            )}
          >
            {children}
          </motion.ul>
        ) : null}
      </AnimatePresence>
    );
  },
);
