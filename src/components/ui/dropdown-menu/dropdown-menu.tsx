"use client";

import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type * as React from "react";
import { useTransitionOpen } from "@/lib/hooks/use-transition-open";

export function DropdownMenu({
  open,
  defaultOpen,
  onOpenChange,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const [isOpen, setOpen] = useTransitionOpen(open, defaultOpen, onOpenChange);
  return (
    <DropdownMenuPrimitive.Root
      data-slot="dropdown-menu"
      {...props}
      open={isOpen}
      onOpenChange={setOpen}
    />
  );
}
