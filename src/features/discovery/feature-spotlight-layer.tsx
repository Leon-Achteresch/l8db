import { useRouterState } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  clearHighlight,
  isAnchorVisible,
  onHighlightLocation,
  useHighlightTarget,
} from "@/lib/discovery/highlight";

const PADDING = 6;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measure(element: HTMLElement): Box {
  const rect = element.getBoundingClientRect();
  return {
    top: rect.top - PADDING,
    left: rect.left - PADDING,
    width: rect.width + PADDING * 2,
    height: rect.height + PADDING * 2,
  };
}

export function FeatureSpotlightLayer() {
  const target = useHighlightTarget();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    onHighlightLocation(pathname);
  }, [pathname]);

  useEffect(() => {
    if (!target) {
      setBox(null);
      return;
    }
    const { element } = target;
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!isAnchorVisible(element)) {
        clearHighlight();
        return;
      }
      setBox(measure(element));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") clearHighlight();
    };
    const onPointer = () => clearHighlight();
    update();
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    resize?.observe(element);
    window.addEventListener("resize", schedule);
    document.addEventListener("scroll", schedule, { capture: true, passive: true });
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer, true);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener("resize", schedule);
      document.removeEventListener("scroll", schedule, { capture: true });
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer, true);
    };
  }, [target]);

  return createPortal(
    <AnimatePresence>
      {target && box && (
        <motion.div
          key={target.id}
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed z-[200] rounded-xl ring-2 ring-primary shadow-[0_0_0_9999px_color-mix(in_oklab,var(--background)_45%,transparent)] forced-colors:outline-2 forced-colors:outline-[color:Highlight]"
          style={box}
          initial={{ opacity: 0, scale: 1.08 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}
        >
          <span
            className={`absolute left-0 max-w-64 truncate rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground ${box.top > 40 ? "-top-8" : "-bottom-8"}`}
          >
            {target.title}
          </span>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
