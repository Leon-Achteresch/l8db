import { useContext } from "react";
import { cn } from "@/lib/utils";
import { MessageContext, type MessageHeaderProps } from "./shared";

export function MessageHeader({ className, ...props }: MessageHeaderProps) {
  const { from } = useContext(MessageContext);
  return (
    <div
      data-slot="message-header"
      className={cn(
        "flex items-center gap-1.5 px-1 text-[11px] leading-none text-muted-foreground",
        from === "user" ? "justify-end" : "justify-start",
        className,
      )}
      {...props}
    />
  );
}
