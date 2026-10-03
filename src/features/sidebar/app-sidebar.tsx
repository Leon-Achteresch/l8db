import { useReducedMotion } from "motion/react";
import type * as React from "react";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { type Sidebar, useSidebar } from "@/components/ui/sidebar";
import { SidebarContext, type SidebarContextProps } from "@/components/ui/sidebar/shared";
import { AppSidebarBody } from "@/features/sidebar/app-sidebar-body";
import { useSidebarPanel } from "@/lib/sidebar-panel";

const SLIDE = { duration: 300, easing: "cubic-bezier(0.32, 0.72, 0, 1)", fill: "both" } as const;

export const AppSidebar = memo(function AppSidebar({
  ...props
}: React.ComponentProps<typeof Sidebar>) {
  const context = useSidebar();
  const contextRef = useRef(context);
  contextRef.current = context;
  const { open, isMobile, openMobile, setOpenMobile } = context;
  const expandedContext = useMemo<SidebarContextProps>(
    () => ({
      state: "expanded",
      open: true,
      setOpen: (value) => contextRef.current.setOpen(value),
      toggleSidebar: () => contextRef.current.toggleSidebar(),
      isMobile,
      openMobile,
      setOpenMobile,
    }),
    [isMobile, openMobile, setOpenMobile],
  );
  const reduceMotion = useReducedMotion();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const animations = useRef<Animation[]>([]);
  const mounted = useRef(false);

  useLayoutEffect(() => {
    const wrapper = wrapperRef.current;
    const panel = panelRef.current;
    const inset = wrapper?.parentElement?.querySelector<HTMLElement>(
      ":scope > [data-slot=sidebar-inset]",
    );
    if (!wrapper || !panel) return;
    const setInert = (inert: boolean) => {
      if (wrapper.inert === inert) return;
      wrapper.inert = inert;
      if (inert) wrapper.setAttribute("aria-hidden", "true");
      else wrapper.removeAttribute("aria-hidden");
    };
    const settle = () => {
      wrapper.style.width = open ? "var(--sidebar-width)" : "0px";
      panel.style.transform = open ? "" : "translateX(-100%)";
      setInert(!open);
      for (const animation of animations.current) animation.cancel();
      animations.current = [];
    };
    const running = animations.current.filter((animation) => animation.playState === "running");
    if (!mounted.current || reduceMotion || !inset || typeof panel.animate !== "function") {
      mounted.current = true;
      settle();
      return;
    }
    if (running.length === animations.current.length && running.length > 0) {
      if (open) setInert(false);
      for (const animation of running) animation.reverse();
      running[0].onfinish = settle;
      return;
    }
    for (const animation of animations.current) animation.cancel();
    if (open) setInert(false);
    const width = `${useSidebarPanel.getState().width}px`;
    wrapper.style.width = "0px";
    panel.style.transform = "";
    const panelFrames = ["translateX(-100%)", "translateX(0)"];
    const insetFrames = ["translateX(0)", `translateX(${width})`];
    if (!open) {
      panelFrames.reverse();
      insetFrames.reverse();
    }
    animations.current = [
      panel.animate({ transform: panelFrames }, SLIDE),
      inset.animate({ transform: insetFrames }, SLIDE),
    ];
    animations.current[0].onfinish = settle;
  }, [open, reduceMotion]);

  return (
    <div ref={wrapperRef} className="relative z-10 flex h-full min-w-0 shrink-0">
      <div ref={panelRef} className="flex h-full w-(--sidebar-width) shrink-0">
        <SidebarContext.Provider value={expandedContext}>
          <AppSidebarBody {...props} />
        </SidebarContext.Provider>
      </div>
    </div>
  );
});
