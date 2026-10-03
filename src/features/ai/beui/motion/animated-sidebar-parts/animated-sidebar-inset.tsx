import { motion } from "motion/react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import type { AnimatedSidebarInsetProps } from "./shared";
export const AnimatedSidebarInset = forwardRef<HTMLElement, AnimatedSidebarInsetProps>(
  function AnimatedSidebarInset({ className, ...props }, forwardedRef) {
    return (
      <motion.main
        {...props}
        ref={forwardedRef}
        data-slot="sidebar-inset"
        className={cn(
          "relative flex min-h-svh min-w-0 flex-1 flex-col bg-background",
          "md:peer-data-[variant=inset]:m-2 md:peer-data-[variant=inset]:ml-0 md:peer-data-[variant=inset]:rounded-2xl md:peer-data-[variant=inset]:shadow-sm",
          className,
        )}
      />
    );
  },
);
