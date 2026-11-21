import { PanelLeftIcon } from "lucide-react";
import type * as React from "react";
import { IconButton } from "@/components/icon-button";
import type { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useSidebar } from "./shared";

export function SidebarTrigger({
  className,
  onClick,
  ...props
}: React.ComponentProps<typeof Button>) {
  const { toggleSidebar } = useSidebar();

  return (
    <IconButton
      aria-label="Seitenleiste umschalten"
      data-hotkey="sidebar.toggle"
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      variant="ghost"
      size="icon-sm"
      className={cn(className)}
      onClick={(event) => {
        onClick?.(event);
        toggleSidebar();
      }}
      {...props}
    >
      <PanelLeftIcon />
    </IconButton>
  );
}
