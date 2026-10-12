import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ICON_MENU_ITEM, useIconMenuAimHandlers } from "./shared";

export function IconMenuRadioItem({
  icon,
  label,
  className,
  onPointerMove,
  onPointerLeave,
  ...props
}: Omit<ComponentProps<typeof DropdownMenuPrimitive.RadioItem>, "children"> & {
  icon: ReactNode;
  label: string;
}) {
  const aim = useIconMenuAimHandlers(onPointerMove, onPointerLeave);
  return (
    <DropdownMenuPrimitive.RadioItem
      aria-label={label}
      data-tip={label}
      className={cn(ICON_MENU_ITEM, className)}
      {...props}
      {...aim}
    >
      {icon}
    </DropdownMenuPrimitive.RadioItem>
  );
}
