import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { useTransitionOpen } from "@/lib/hooks/use-transition-open";

export function IconMenu({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const [isOpen, setOpen] = useTransitionOpen(open, defaultOpen, onOpenChange);
  return <DropdownMenuPrimitive.Root {...props} open={isOpen} onOpenChange={setOpen} />;
}
