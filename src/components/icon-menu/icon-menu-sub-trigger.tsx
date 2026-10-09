import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ICON_MENU_ITEM, useIconMenuAimHandlers } from "./shared";

export function IconMenuSubTrigger({
  icon,
  label,
  className,
  onPointerMove,
  onPointerLeave,
  ...props
}: Omit<ComponentProps<typeof DropdownMenuPrimitive.SubTrigger>, "children"> & {
  icon: ReactNode;
  label: string;
}) {
  const aim = useIconMenuAimHandlers(onPointerMove, onPointerLeave);
  return (
    <DropdownMenuPrimitive.SubTrigger
      aria-label={label}
      data-tip={label}
      className={cn(
        ICON_MENU_ITEM,
        "after:absolute after:right-1 after:bottom-1 after:size-1 after:rounded-full after:bg-current after:opacity-40",
        className,
      )}
      {...props}
      {...aim}
    >
      {icon}
    </DropdownMenuPrimitive.SubTrigger>
  );
}
