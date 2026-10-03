import { motion } from "motion/react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";
import { MobileSidebar } from "./mobile-sidebar";
import {
  AnimatedSidebarPanelContext,
  type AnimatedSidebarProps,
  PANEL_TRANSITION,
  REDUCED_TRANSITION,
  SIDEBAR_MORPH_TRANSITION,
  useAnimatedSidebar,
} from "./shared";
export const AnimatedSidebar = forwardRef<HTMLElement, AnimatedSidebarProps>(
  function AnimatedSidebar(
    {
      side = "left",
      variant = "sidebar",
      collapsible = "icon",
      ariaLabel = "Sidebar",
      children,
      className,
      panelClassName,
      style,
      ...props
    },
    forwardedRef,
  ) {
    const context = useAnimatedSidebar();
    const collapsed = collapsible !== "none" && !context.open;
    const offcanvas = collapsed && collapsible === "offcanvas";
    const width = offcanvas
      ? "0px"
      : collapsed
        ? "var(--sidebar-width-icon)"
        : "var(--sidebar-width)";
    if (context.isMobile) {
      return (
        <MobileSidebar ariaLabel={ariaLabel} className={className} side={side}>
          {children}
        </MobileSidebar>
      );
    }
    return (
      <motion.aside
        {...props}
        ref={forwardedRef}
        initial={false}
        aria-label={ariaLabel}
        data-slot="sidebar"
        data-state={collapsed ? "collapsed" : "expanded"}
        data-collapsible={collapsible}
        data-variant={variant}
        data-side={side}
        animate={{ width }}
        transition={context.reduce ? { duration: 0 } : SIDEBAR_MORPH_TRANSITION}
        style={style}
        className={cn(
          "group/sidebar relative hidden h-auto shrink-0 md:block will-change-[width]",
          "peer",
          side === "right" && "order-last",
          className,
        )}
      >
        <motion.div
          initial={false}
          animate={{
            opacity: offcanvas ? 0 : 1,
            x: offcanvas ? (side === "left" ? "-100%" : "100%") : "0%",
          }}
          transition={context.reduce ? REDUCED_TRANSITION : PANEL_TRANSITION}
          className={cn(
            "sticky top-0 flex h-svh w-full flex-col overflow-hidden bg-background",
            collapsible === "offcanvas" && "w-[var(--sidebar-width)]",
            variant === "sidebar" &&
              (side === "left" ? "border-border border-r" : "border-border border-l"),
            variant === "floating" &&
              "m-2 h-[calc(100svh-1rem)] rounded-2xl border border-border shadow-sm",
            variant === "inset" && "m-2 h-[calc(100svh-1rem)] rounded-2xl",
            panelClassName,
          )}
        >
          <AnimatedSidebarPanelContext.Provider value={{ collapsed, collapsible, side }}>
            {children}
          </AnimatedSidebarPanelContext.Provider>
        </motion.div>
      </motion.aside>
    );
  },
);
