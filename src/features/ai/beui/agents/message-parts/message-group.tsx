import { cn } from "@/lib/utils";
import type { MessageGroupProps } from "./shared";

export function MessageGroup({ spacing = "compact", className, ...props }: MessageGroupProps) {
  return (
    <div
      data-slot="message-group"
      className={cn("flex w-full flex-col", spacing === "compact" ? "gap-1.5" : "gap-4", className)}
      {...props}
    />
  );
}
