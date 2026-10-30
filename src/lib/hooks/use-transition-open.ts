import { useEffect, useState, useTransition } from "react";

export function useTransitionOpen(
  open: boolean | undefined,
  defaultOpen: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen ?? false);
  const [pending, startTransition] = useTransition();
  const change = (next: boolean) => {
    const apply = () => {
      if (open === undefined) setUncontrolled(next);
      onOpenChange?.(next);
    };
    if (next) startTransition(apply);
    else apply();
  };
  useEffect(() => {
    if (!pending) return;
    const cancel = (event: KeyboardEvent | PointerEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        event.preventDefault();
      }
      if (open === undefined) setUncontrolled(false);
      onOpenChange?.(false);
    };
    window.addEventListener("keydown", cancel, true);
    window.addEventListener("pointerdown", cancel, true);
    return () => {
      window.removeEventListener("keydown", cancel, true);
      window.removeEventListener("pointerdown", cancel, true);
    };
  }, [pending, open, onOpenChange]);
  return [open ?? uncontrolled, change] as const;
}
