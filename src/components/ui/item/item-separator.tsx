import * as React from "react";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

export function ItemSeparator({ className, ...props }: React.ComponentProps<typeof Separator>) {
  return (
    <Separator
      data-slot="item-separator"
      orientation="horizontal"
      className={cn("my-2", className)}
      {...props}
    />
  );
}
