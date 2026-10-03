import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import { type ComponentProps, useCallback, useState } from "react";
import { IconMenuCloseContext } from "./shared";

export function IconMenu({
  open,
  defaultOpen = false,
  onOpenChange,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const [innerOpen, setInnerOpen] = useState(defaultOpen);
  const setOpen = useCallback(
    (next: boolean) => {
      setInnerOpen(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );
  const close = useCallback(() => setOpen(false), [setOpen]);
  return (
    <IconMenuCloseContext.Provider value={close}>
      <DropdownMenuPrimitive.Root open={open ?? innerOpen} onOpenChange={setOpen} {...props} />
    </IconMenuCloseContext.Provider>
  );
}
