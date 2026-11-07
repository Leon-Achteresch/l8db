import { Dialog as SheetPrimitive } from "radix-ui";
import type * as React from "react";
import { useTransitionOpen } from "@/lib/hooks/use-transition-open";

export function Sheet({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Root>) {
  const [isOpen, setOpen] = useTransitionOpen(open, defaultOpen, onOpenChange);
  return <SheetPrimitive.Root data-slot="sheet" {...props} open={isOpen} onOpenChange={setOpen} />;
}
