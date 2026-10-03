import { useContext } from "react";
import { cn } from "@/lib/utils";
import { type MessageContentProps, MessageContext } from "./shared";

export function MessageContent({ className, ...props }: MessageContentProps) {
  const { from } = useContext(MessageContext);
  return (
    <div
      data-slot="message-content"
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-1.5",
        from === "user" ? "items-end" : "items-start",
        className,
      )}
      {...props}
    />
  );
}
