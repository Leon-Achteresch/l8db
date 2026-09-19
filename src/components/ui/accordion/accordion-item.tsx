import { Accordion as AccordionPrimitive } from "radix-ui";
import * as React from "react";
import { cn } from "@/lib/utils";

export function AccordionItem({
  className,
  ...props
}: React.ComponentProps<typeof AccordionPrimitive.Item>) {
  return (
    <AccordionPrimitive.Item
      data-slot="accordion-item"
      className={cn("not-last:border-b", className)}
      {...props}
    />
  );
}
