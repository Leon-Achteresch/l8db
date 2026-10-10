import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { IconMenuTip } from "./icon-menu-tip";
import { ICON_MENU_SURFACE, IconMenuAimContext } from "./shared";
import { useIconMenuSurface } from "./use-icon-menu-surface";

export function IconMenuContent({
  className,
  align = "end",
  sideOffset = 6,
  onKeyDown,
  onPointerMove,
  onPointerOver,
  onPointerLeave,
  onFocus,
  onBlur,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  const surface = useIconMenuSurface({
    onKeyDown,
    onPointerMove,
    onPointerOver,
    onPointerLeave,
    onFocus,
    onBlur,
  });
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        data-icon-menu=""
        align={align}
        sideOffset={sideOffset}
        loop
        className={cn(ICON_MENU_SURFACE, className)}
        {...props}
        {...surface.props}
      >
        <IconMenuAimContext.Provider value={surface.aim}>
          {children}
          <IconMenuTip ref={surface.tipRef} />
        </IconMenuAimContext.Provider>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}
