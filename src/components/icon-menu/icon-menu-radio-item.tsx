import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconMenuTooltip } from "./icon-menu-tooltip";
import { ICON_MENU_ITEM } from "./shared";

export function IconMenuRadioItem({
  icon,
  label,
  className,
  ...props
}: Omit<ComponentProps<typeof DropdownMenuPrimitive.RadioItem>, "children"> & {
  icon: ReactNode;
  label: string;
}) {
  return (
    <IconMenuTooltip label={label}>
      <DropdownMenuPrimitive.RadioItem
        aria-label={label}
        className={cn(ICON_MENU_ITEM, className)}
        {...props}
      >
        {icon}
      </DropdownMenuPrimitive.RadioItem>
    </IconMenuTooltip>
  );
}
