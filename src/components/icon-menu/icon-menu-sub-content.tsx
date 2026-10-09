import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";
import { IconMenuTip } from "./icon-menu-tip";
import { ICON_MENU_SURFACE, IconMenuAimContext } from "./shared";
import { useIconMenuSurface } from "./use-icon-menu-surface";

export function IconMenuSubContent({
  className,
  onKeyDown,
  onPointerMove,
  onPointerOver,
  onPointerLeave,
  onFocus,
  onBlur,
  children,
  ...props
}: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
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
      <DropdownMenuPrimitive.SubContent
        data-icon-menu=""
        data-side="bottom"
        sideOffset={-32}
        alignOffset={42}
        loop
        className={cn(ICON_MENU_SURFACE, "max-w-none flex-nowrap", className)}
        {...props}
        {...surface.props}
      >
        <IconMenuAimContext.Provider value={surface.aim}>
          {children}
          <IconMenuTip ref={surface.tipRef} />
        </IconMenuAimContext.Provider>
      </DropdownMenuPrimitive.SubContent>
    </DropdownMenuPrimitive.Portal>
  );
}
