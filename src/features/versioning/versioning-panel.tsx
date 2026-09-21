import { motion, useReducedMotion } from "motion/react";
import { lazy, Suspense, useEffect, useState } from "react";
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
  useEffect(() => {
    if (open) setVisited(true);
  }, [open]);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (transactionsOpen && useTransactionStore.getState().panelOpen) setOpen(false);
  }, [transactionsOpen, setOpen]);
  return (
    <motion.aside
      id="versioning-panel"
      aria-label="Versionierung"
      aria-hidden={!open}
      inert={!open}
      initial={false}
      animate={{ width: open ? 560 : 0, opacity: open ? 1 : 0 }}
      transition={{ duration: reduced ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="h-full min-h-0 max-w-full shrink-0 overflow-hidden bg-background"
    >
      <div className="h-full w-[560px] max-w-full border-l border-border/60">
        {(open || visited) && (
          <Suspense
            fallback={<div className="p-5 text-xs text-muted-foreground">Versionierung laden…</div>}
          >
            <VersioningView workspace={workspace} />
          </Suspense>
        )}
      </div>
    </motion.aside>
  );
}
