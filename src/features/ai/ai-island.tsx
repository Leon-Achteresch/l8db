import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAiStore } from "@/lib/ai/store";
import { useRouterSelect } from "@/lib/hooks/use-router-select";
import { AiResizeHandle } from "./ai-resize-handle";
import { AiView } from "./ai-view";

export function AiIsland() {
  const open = useAiStore((state) => state.open);
  const width = useAiStore((state) => state.width);
  const setOpen = useAiStore((state) => state.setOpen);
  const fullPage = useRouterSelect((state) => state.location.pathname === "/ai");
  const minimized = useAiStore((state) => state.minimized) && open && !fullPage;
  const [active, setActive] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const mini = useRef<HTMLElement>(null);
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "flex h-full min-h-0 w-full flex-col";
    return element;
  });
  useLayoutEffect(() => {
    const attach = () => {
      const destination = fullPage
        ? document.getElementById("ai-page-surface")
        : minimized
          ? mini.current
          : panel.current;
      if (destination && host.parentElement !== destination) destination.appendChild(host);
    };
    attach();
    window.addEventListener("ai-workspace-surface-ready", attach);
    return () => window.removeEventListener("ai-workspace-surface-ready", attach);
  }, [fullPage, minimized, host]);
  useEffect(() => {
    if (!minimized) setActive(false);
  }, [minimized]);
  useEffect(() => {
    const element = mini.current;
    if (!minimized || !element) return;
    const onPointer = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      if (element.contains(event.target)) {
        setActive(true);
        if (!event.target.closest("button, textarea"))
          requestAnimationFrame(() => host.querySelector("textarea")?.focus());
      } else if (
        !event.target.closest('[role="dialog"], [data-slot$="-content"], [role="listbox"]')
      )
        setActive(false);
    };
    const onFocus = () => setActive(true);
    window.addEventListener("pointerdown", onPointer);
    element.addEventListener("focusin", onFocus);
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      element.removeEventListener("focusin", onFocus);
    };
  }, [minimized, host]);
  useEffect(() => {
    if (fullPage) return;
    if (!open) {
      if (host.contains(document.activeElement))
        document.getElementById("ai-workspace-trigger")?.focus();
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        !(event.target instanceof HTMLElement) ||
        !host.contains(event.target) ||
        event.target.closest('[role="dialog"], [data-slot="popover-content"], [role="listbox"]')
      )
        return;
      if (minimized) {
        setActive(false);
        event.target.blur();
        return;
      }
      setOpen(false);
      document.getElementById("ai-workspace-trigger")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen, fullPage, minimized, host]);
  return (
    <>
      <div hidden={!open || fullPage || minimized} className="flex min-h-0 shrink-0">
        <AiResizeHandle />
        <div
          ref={panel}
          id="ai-workspace"
          style={{ width }}
          className="my-2 mr-2 min-h-0 max-w-[calc(100vw-320px)] overflow-hidden rounded-xl border bg-background"
        />
      </div>
      <section
        ref={mini}
        hidden={!minimized}
        aria-label="AI-Chat"
        data-active={active || undefined}
        className="group/mini fixed bottom-4 left-1/2 z-40 flex max-h-[85vh] w-[min(44rem,calc(100vw-2rem))] origin-bottom -translate-x-1/2 scale-[0.96] flex-col overflow-visible rounded-3xl border border-transparent data-active:overflow-hidden transition-[scale,background-color,border-color,box-shadow] duration-200 ease-out hover:scale-100 data-active:scale-100 data-active:border-border data-active:bg-background/95 data-active:shadow-2xl data-active:shadow-black/15 data-active:backdrop-blur motion-reduce:transition-none dark:data-active:shadow-black/40"
      />
      {createPortal(<AiView fullPage={fullPage} />, host)}
    </>
  );
}
