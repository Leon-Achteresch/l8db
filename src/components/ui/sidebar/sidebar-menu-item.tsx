import * as React from "react";
import { cn } from "@/lib/utils";

export function SidebarMenuItem({ className, children }: React.ComponentProps<"li">) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={cn("group/menu-item relative", className)}
    >
      {children}
    </li>
  );
}
