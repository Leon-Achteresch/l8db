"use client";

import { CheckIcon } from "lucide-react";
import { Select as SelectPrimitive } from "radix-ui";
import * as React from "react";
import { matchesSelectSearch } from "@/lib/select-search";
import { cn } from "@/lib/utils";
import { SelectClosedValueContext, SelectSearchContext } from "./shared";

export function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof SelectPrimitive.Item>) {
  const query = React.useContext(SelectSearchContext);
  const closedValue = React.useContext(SelectClosedValueContext);
  if (closedValue !== null && props.value !== closedValue) return null;
  const filtered = !matchesSelectSearch(children, props.value, query);

  return (
    <SelectPrimitive.Item
      data-slot="select-item"
      className={cn(
        "relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground [&:not([data-variant=destructive]):focus_*]:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 [&>span]:last:flex [&>span]:last:items-center [&>span]:last:gap-2",
        filtered && "hidden",
        className,
      )}
      {...props}
      data-filtered={filtered ? "" : undefined}
      disabled={props.disabled || filtered}
    >
      <span className="pointer-events-none absolute right-2 flex size-4 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="pointer-events-none" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
