import { HoverCard as HoverCardPrimitive } from "radix-ui";
import * as React from "react";

export function HoverCardTrigger({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />;
}
