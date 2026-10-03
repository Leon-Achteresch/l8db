import { cn } from "@/lib/utils";
import type { MessageBubbleGroupProps } from "./shared";

export function MessageBubbleGroup({
  spacing = "compact",
  className,
  ...props
}: MessageBubbleGroupProps) {
  return (
    <div
      data-slot="message-bubble-group"
      className={cn("flex w-full flex-col", spacing === "compact" ? "gap-1.5" : "gap-3", className)}
      {...props}
    />
  );
}
