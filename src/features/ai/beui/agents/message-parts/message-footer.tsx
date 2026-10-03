import { useContext } from "react";
import { cn } from "@/lib/utils";
import { MessageContext, type MessageFooterProps } from "./shared";

export function MessageFooter({ className, ...props }: MessageFooterProps) {
  const { from } = useContext(MessageContext);
  return (
    <div
      data-slot="message-footer"
      className={cn(
        "flex min-h-5 items-center gap-1 px-1 text-[11px] text-muted-foreground",
        from === "user" ? "justify-end" : "justify-start",
        className,
      )}
      {...props}
    />
  );
}
