import { type ReactNode, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function GlideMenu({
  children,
  className,
  highlightClassName,
  rowSelector = "[data-menu-row]",
}: {
  children: ReactNode;
  className?: string;
  highlightClassName?: string;
  rowSelector?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ top: number; height: number } | null>(null);
  const [visible, setVisible] = useState(false);
  const moveTo = (target: EventTarget | null) => {
    const container = ref.current;
    if (!(target instanceof Element) || !container) return;
    const row = target.closest(rowSelector);
    if (!(row instanceof HTMLElement) || !container.contains(row)) return;
    if (row.matches(":disabled, [aria-disabled=true]")) return;
    const bounds = container.getBoundingClientRect();
    const rect = row.getBoundingClientRect();
    setBox({ top: rect.top - bounds.top + container.scrollTop, height: rect.height });
    setVisible(true);
  };
  return (
    <div
      ref={ref}
      role="group"
      onMouseOver={(event) => moveTo(event.target)}
      onMouseLeave={() => setVisible(false)}
      onFocus={(event) => moveTo(event.target)}
      onBlur={(event) => {
        if (!ref.current?.contains(event.relatedTarget as Node | null)) setVisible(false);
      }}
      className={cn("relative", className)}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-x-0 rounded-md bg-muted/70 transition-[top,height,opacity] duration-200 ease-smooth-out motion-reduce:transition-opacity",
          highlightClassName,
        )}
        style={{ top: box?.top ?? 0, height: box?.height ?? 0, opacity: box && visible ? 1 : 0 }}
      />
      {children}
    </div>
  );
}
