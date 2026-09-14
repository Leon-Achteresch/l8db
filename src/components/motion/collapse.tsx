import type { ReactNode, TransitionEvent } from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface CollapseProps {
  open: boolean;
  children: ReactNode;
  className?: string;
  durationMs?: number;
}

export function Collapse({ open, children, className, durationMs = 240 }: CollapseProps) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  const openRef = useRef(open);
  openRef.current = open;

  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    setMounted(true);
    const frame = requestAnimationFrame(() => {
      if (openRef.current) setShown(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const handleTransitionEnd = (event: TransitionEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.propertyName !== "grid-template-rows") return;
    if (!openRef.current) setMounted(false);
  };

  if (!mounted) return null;

  return (
    <div
      onTransitionEnd={handleTransitionEnd}
      style={{
        display: "grid",
        gridTemplateRows: shown ? "1fr" : "0fr",
        transition: `grid-template-rows ${durationMs}ms cubic-bezier(0.32, 0.72, 0, 1)`,
        contain: "layout paint",
      }}
      className={cn("motion-reduce:transition-none", className)}
    >
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
