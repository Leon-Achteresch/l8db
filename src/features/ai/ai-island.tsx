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
  const panel = useRef<HTMLDivElement>(null);
  const [host] = useState(() => {
    const element = document.createElement("div");
    element.className = "flex h-full min-h-0 w-full flex-col";
    return element;
  });
  useLayoutEffect(() => {
    const attach = () => {
      const destination = fullPage ? document.getElementById("ai-page-surface") : panel.current;
      if (destination && host.parentElement !== destination) destination.appendChild(host);
    };
    attach();
    window.addEventListener("ai-workspace-surface-ready", attach);
    return () => window.removeEventListener("ai-workspace-surface-ready", attach);
  }, [fullPage, host]);
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
      setOpen(false);
      document.getElementById("ai-workspace-trigger")?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, setOpen, fullPage, host]);
  return (
    <>
      <div hidden={!open || fullPage} className="flex min-h-0 shrink-0">
        <AiResizeHandle />
        <div
          ref={panel}
          id="ai-workspace"
          style={{ width }}
          className="my-2 mr-2 min-h-0 max-w-[calc(100vw-320px)] overflow-hidden rounded-xl border bg-background"
        />
      </div>
      {createPortal(<AiView fullPage={fullPage} />, host)}
    </>
  );
}
