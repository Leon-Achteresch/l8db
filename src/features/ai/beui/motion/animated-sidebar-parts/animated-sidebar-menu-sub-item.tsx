import type { HTMLMotionProps } from "motion/react";
import { motion } from "motion/react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { SUBMENU_ITEM_VARIANTS } from "./shared";
export const AnimatedSidebarMenuSubItem = forwardRef<HTMLLIElement, HTMLMotionProps<"li">>(
  function AnimatedSidebarMenuSubItem({ className, ...props }, forwardedRef) {
    return (
      <motion.li
        {...props}
        ref={forwardedRef}
        variants={SUBMENU_ITEM_VARIANTS}
        data-slot="sidebar-menu-sub-item"
        className={cn("relative min-w-0", className)}
      />
    );
  },
);
