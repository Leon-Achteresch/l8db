import { startTransition, useState } from "react";

export function useTransitionOpen(
  open: boolean | undefined,
  defaultOpen: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
) {
  const [uncontrolled, setUncontrolled] = useState(defaultOpen ?? false);
  const change = (next: boolean) => {
    const apply = () => {
      if (open === undefined) setUncontrolled(next);
      onOpenChange?.(next);
    };
    if (next) startTransition(apply);
    else apply();
  };
  return [open ?? uncontrolled, change] as const;
}
