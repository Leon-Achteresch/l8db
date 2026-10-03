import type { HTMLMotionProps } from "motion/react";
import { motion } from "motion/react";
import { forwardRef } from "react";
import { SPRING_LAYOUT } from "@/features/ai/beui/lib/ease";
import { cn } from "@/lib/utils";
export const AnimatedSidebarMenuItem = forwardRef<HTMLLIElement, HTMLMotionProps<"li">>(
  function AnimatedSidebarMenuItem({ className, ...props }, forwardedRef) {
    return (
      <motion.li
        {...props}
        ref={forwardedRef}
        layout="position"
        transition={SPRING_LAYOUT}
        data-slot="sidebar-menu-item"
        className={cn("relative", className)}
      />
    );
  },
);
