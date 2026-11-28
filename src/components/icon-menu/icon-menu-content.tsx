import { DropdownMenu as DropdownMenuPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { DropdownMenuArrow } from "@/components/ui/dropdown-menu/dropdown-menu-arrow";
import { useMenuArrowContainer } from "@/components/ui/dropdown-menu/use-menu-arrow-container";
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
  ref,
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
  const [arrowContainer, attach] = useMenuArrowContainer(ref);
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        ref={attach}
        data-icon-menu=""
        arrowPadding={14}
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
          <DropdownMenuArrow
            container={arrowContainer}
            className="fill-popover stroke-border/70 [stroke-width:2px]"
          />
        </IconMenuAimContext.Provider>
      </DropdownMenuPrimitive.Content>
    </DropdownMenuPrimitive.Portal>
  );
}
