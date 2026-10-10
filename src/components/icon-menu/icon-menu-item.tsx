import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ICON_MENU_ITEM, useIconMenuAimHandlers } from "./shared";

export function IconMenuItem({
  icon,
  label,
  shortcut,
  variant = "default",
  className,
  onPointerMove,
  onPointerLeave,
  children,
  ...props
}: Omit<ComponentProps<typeof DropdownMenuPrimitive.Item>, "children"> & {
  icon: ReactNode;
  label: string;
  shortcut?: string;
  variant?: "default" | "destructive";
  children?: ReactNode;
}) {
  const aim = useIconMenuAimHandlers(onPointerMove, onPointerLeave);
  return (
    <DropdownMenuPrimitive.Item
      aria-label={label}
      data-tip={label}
      data-tip-shortcut={shortcut}
      data-variant={variant}
      className={cn(ICON_MENU_ITEM, className)}
      {...props}
      {...aim}
    >
      {icon}
      {children}
    </DropdownMenuPrimitive.Item>
  );
}
