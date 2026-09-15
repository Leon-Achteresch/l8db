import type { ReactNode, TransitionEvent } from "react";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface CollapseProps {
  open: boolean;
  children: ReactNode;
  className?: string;
  durationMs?: number;
}

function prefersReducedMotion() {
  return (
    typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  );
}

export function Collapse({ open, children, className, durationMs = 250 }: CollapseProps) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      if (typeof requestAnimationFrame !== "function") {
        setShown(true);
        return;
      }
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    if (prefersReducedMotion()) {
      setMounted(false);
      return;
    }
    if (typeof window === "undefined") {
      setMounted(false);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), durationMs);
    return () => window.clearTimeout(timer);
  }, [open, durationMs]);

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== "grid-template-rows") return;
    if (!open) setMounted(false);
  };

  if (!mounted) return null;

  return (
    <div
      onTransitionEnd={handleTransitionEnd}
      style={{
        display: "grid",
        gridTemplateRows: shown ? "1fr" : "0fr",
        transition: `grid-template-rows ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`,
        contain: "layout paint",
      }}
      className={cn("motion-reduce:transition-none", className)}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
