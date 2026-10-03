import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { IconMenuTooltip } from "./icon-menu-tooltip";
import { ICON_MENU_ITEM } from "./shared";

export function IconMenuItem({
  icon,
  label,
  shortcut,
  variant = "default",
  className,
  children,
  ...props
}: Omit<ComponentProps<typeof DropdownMenuPrimitive.Item>, "children"> & {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  variant?: "default" | "destructive";
  children?: ReactNode;
}) {
  return (
    <IconMenuTooltip label={label} shortcut={shortcut}>
      <DropdownMenuPrimitive.Item
        aria-label={label}
        data-variant={variant}
        className={cn(ICON_MENU_ITEM, className)}
        {...props}
      >
        {icon}
        {children}
      </DropdownMenuPrimitive.Item>
    </IconMenuTooltip>
  );
}
