"use client";
import * as React from "react";
import { cn } from "@/lib/utils";

export function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn(
        "ml-auto pl-6 text-xs text-muted-foreground group-focus/dropdown-menu-item:opacity-75",
        className,
      )}
      {...props}
    />
  );
}
