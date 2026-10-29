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
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (open === undefined) setUncontrolled(false);
      onOpenChange?.(false);
    };
    document.addEventListener("keydown", cancel, true);
    document.addEventListener("pointerdown", cancel, true);
    return () => {
      document.removeEventListener("keydown", cancel, true);
      document.removeEventListener("pointerdown", cancel, true);
    };
  }, [pending, open, onOpenChange]);
  return [open ?? uncontrolled, change] as const;
}
