import { useEffect, useRef } from "react";
import { useAnimatedSidebar } from "@/features/ai/beui/motion/animated-sidebar";

export function ShellFit({ minWidth }: { minWidth: number }) {
  const { open, setOpen } = useAnimatedSidebar();
  const markerRef = useRef<HTMLDivElement>(null);
  const narrowRef = useRef<boolean | null>(null);
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const shell = markerRef.current?.parentElement;
    if (!shell) return;
    const observer = new ResizeObserver(([entry]) => {
      const narrow = entry.contentRect.width < minWidth;
      if (narrowRef.current === narrow) return;
      const first = narrowRef.current === null;
      narrowRef.current = narrow;
      if (first && !narrow) return;
      const wanted = !narrow;
      if (openRef.current === wanted) return;
      setOpen(wanted);
    });
    observer.observe(shell);
    return () => observer.disconnect();
  }, [minWidth, setOpen]);
  return <div ref={markerRef} className="hidden" />;
}
