import { animate, motion, useMotionValue, useReducedMotion, useTransform } from "motion/react";
import type * as React from "react";
import { memo, useEffect } from "react";
import { Sidebar, useSidebar } from "@/components/ui/sidebar";
import { AppSidebarPanel } from "@/features/sidebar/app-sidebar-panel";
import { AppSidebarResizeHandle } from "@/features/sidebar/app-sidebar-resize-handle";
import { useSidebarPanel } from "@/lib/sidebar-panel";
import { cn } from "@/lib/utils";

export const AppSidebar = memo(function AppSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const isResizing = useSidebarPanel((state) => state.isResizing);
  const panelWidth = useSidebarPanel((state) => state.width);
  const { open } = useSidebar();
  const reduceMotion = useReducedMotion();
  const progress = useMotionValue(open ? 1 : 0);
  const liveWidth = useMotionValue(panelWidth);
  const width = useTransform([progress, liveWidth], ([current, target]: number[]) =>
    Math.round(current * target),
  );

  useEffect(() => {
    if (!useSidebarPanel.getState().isResizing) liveWidth.set(panelWidth);
  }, [panelWidth, liveWidth]);

  useEffect(() => {
    if (reduceMotion) {
      progress.set(open ? 1 : 0);
      return;
    }
    const animation = animate(progress, open ? 1 : 0, {
      type: "spring",
      stiffness: 400,
      damping: 40,
      restDelta: 0.002,
    });

    return () => animation.stop();
  }, [open, progress, reduceMotion]);

  return (
    <motion.div
      className="flex h-full min-w-0 shrink-0 overflow-hidden"
      style={{ width }}
      inert={!open}
      aria-hidden={!open}
    >
      <Sidebar
        collapsible="none"
        className={cn(
          "relative h-full shrink-0 flex-row overflow-visible",
          "w-(--sidebar-width)",
          isResizing && "[&_*]:transition-none!",
        )}
        {...props}
      >
        <AppSidebarPanel />
        <AppSidebarResizeHandle liveWidth={liveWidth} />
      </Sidebar>
    </motion.div>
  );
});
