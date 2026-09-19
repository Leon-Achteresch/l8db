import { HoverCard as HoverCardPrimitive } from "radix-ui";
import * as React from "react";

export function HoverCard({ ...props }: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />;
}
