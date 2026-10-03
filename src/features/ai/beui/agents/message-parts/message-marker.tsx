import { cn } from "@/lib/utils";
import type { MessageMarkerProps } from "./shared";

export function MessageMarker({ className, ...props }: MessageMarkerProps) {
  return (
    <div
      data-slot="message-marker"
      className={cn(
        "mx-auto flex w-fit max-w-[88%] items-center gap-1.5 rounded-full bg-muted/70 px-2.5 py-1 text-center text-xs text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
