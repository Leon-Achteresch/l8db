import { ChevronRightIcon } from "lucide-react";
import { ContextMenu as ContextMenuPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function ContextMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof ContextMenuPrimitive.SubTrigger> & {
  inset?: boolean;
}) {
  return (
    <ContextMenuPrimitive.SubTrigger
      data-slot="context-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        "group/context-menu-item flex cursor-default items-center gap-2 pr-2 rounded-[5px] py-0.75 pl-2.5 text-[13px] leading-5 outline-hidden select-none focus:bg-(--menu-highlight) focus:text-white [&:focus_*]:text-white data-inset:pl-8 data-open:not-focus:bg-foreground/6 data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-3.5 text-muted-foreground group-focus/context-menu-item:opacity-75" />
    </ContextMenuPrimitive.SubTrigger>
  );
}
