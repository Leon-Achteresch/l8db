import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconMenuTooltip } from "./icon-menu-tooltip";
import { ICON_MENU_ITEM } from "./shared";

export function IconMenuSubTrigger({
  icon,
  label,
  className,
  ...props
}: Omit<ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>, "children"> & {
  icon: ReactNode;
  label: string;
}) {
  return (
    <IconMenuTooltip label={label}>
      <DropdownMenuPrimitive.SubTrigger
        aria-label={label}
        className={cn(
          ICON_MENU_ITEM,
          "after:absolute after:right-1 after:bottom-1 after:size-1 after:rounded-full after:bg-current after:opacity-40",
          className,
        )}
        {...props}
      >
        {icon}
      </DropdownMenuPrimitive.SubTrigger>
    </IconMenuTooltip>
  );
}
