import { motion, useReducedMotion } from "motion/react";
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTransactionStore } from "@/lib/transactions";
import { useVersioningPanel } from "@/lib/versioning/panel";
import { useVersioning } from "./use-versioning";

const VersioningView = lazy(() =>
  import("./versioning-view").then((module) => ({ default: module.VersioningView })),
);

export function VersioningPanel() {
  const workspace = useVersioning();
  const [visited, setVisited] = useState(false);
  const open = useVersioningPanel((state) => state.open);
  const setOpen = useVersioningPanel((state) => state.setOpen);
  const transactionsOpen = useTransactionStore((state) => state.panelOpen);
  const mode = useVersioningPanel((state) => state.mode);
  const tabHost = useVersioningPanel((state) => state.tabHost);
  const panelHost = useRef<HTMLDivElement>(null);
  const [container] = useState(() => {
    const element = document.createElement("div");
    element.className = "h-full min-h-0";
    return element;
  });
  const inTab = mode === "tab";
  useLayoutEffect(() => {
    const host = inTab ? tabHost : panelHost.current;
    if (host) host.appendChild(container);
    return () => container.remove();
  }, [inTab, tabHost, container]);
  useEffect(() => {
    if (open) setVisited(true);
  }, [open]);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (transactionsOpen && useTransactionStore.getState().panelOpen) setOpen(false);
  }, [transactionsOpen, setOpen]);
  return (
    <>
      <motion.aside
        id="versioning-aside"
        aria-label="Versionierung"
        aria-hidden={!open || inTab}
        inert={!open || inTab}
        initial={false}
        animate={{ width: open && !inTab ? 620 : 0, opacity: open && !inTab ? 1 : 0 }}
        transition={{ duration: reduced ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="h-full min-h-0 max-w-full shrink-0 overflow-hidden bg-background"
      >
        <div ref={panelHost} className="h-full w-[620px] max-w-full border-l border-border/60" />
      </motion.aside>
      {(open || visited) &&
        createPortal(
          <div id="versioning-panel" aria-hidden={!open} inert={!open} className="h-full min-h-0">
            <Suspense
              fallback={
                <div className="p-5 text-xs text-muted-foreground">Versionierung laden…</div>
              }
            >
              <VersioningView workspace={workspace} />
            </Suspense>
          </div>,
          container,
        )}
    </>
  );
}
