import * as React from "react";
import { cn } from "@/lib/utils";

export function AvatarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        "group/avatar-group flex -space-x-2 [&>[data-slot=avatar]]:ring-2 [&>[data-slot=avatar]]:ring-background",
        className,
      )}
      {...props}
    />
  );
}
