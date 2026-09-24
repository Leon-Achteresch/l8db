"use client";

import { ChevronDownIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function SelectTrigger({
  className,
  size = "default",
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Trigger> & {
  size?: "sm" | "default";
}) {
  return (
    <SelectPrimitive.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "flex w-fit items-center justify-between gap-1.5 rounded-md border border-input bg-transparent py-2 pr-2 pl-2.5 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 data-placeholder:text-muted-foreground data-[size=default]:h-[calc(2.25rem+var(--ui-density-step))] data-[size=sm]:h-[calc(2rem+var(--ui-density-step))] [&>[data-slot=select-value]]:min-w-0 [&>[data-slot=select-value]]:overflow-hidden [&>[data-slot=select-value]]:text-ellipsis [&>[data-slot=select-value]]:line-clamp-1 [&>[data-slot=select-value]]:flex [&>[data-slot=select-value]]:items-center [&>[data-slot=select-value]]:gap-1.5 dark:bg-input/30 dark:hover:bg-input/50 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}
