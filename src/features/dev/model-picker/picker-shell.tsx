import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export function PickerShell({
  trigger,
  children,
  className,
}: {
  trigger: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      {trigger(open, () => setOpen(!open))}
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Modell auswählen"
            initial={
              reduced ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.96, filter: "blur(4px)" }
            }
            animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97, filter: "blur(2px)" }}
            transition={{ type: "spring", stiffness: 520, damping: 34, mass: 0.7 }}
            style={{ transformOrigin: "bottom right" }}
            className={cn(
              "absolute right-0 bottom-full z-20 mb-2 overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl shadow-black/20",
              className,
            )}
          >
            {children(() => setOpen(false))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
