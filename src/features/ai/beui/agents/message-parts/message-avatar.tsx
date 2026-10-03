import { cn } from "@/lib/utils";
import type { MessageAvatarProps } from "./shared";

export function MessageAvatar({
  placeholder = false,
  children,
  className,
  ...props
}: MessageAvatarProps) {
  return (
    <div
      data-slot="message-avatar"
      aria-hidden={placeholder || undefined}
      className={cn(
        "grid size-7 shrink-0 place-items-center overflow-hidden rounded-full bg-muted text-xs font-medium text-muted-foreground [&_img]:size-full [&_img]:object-cover [&_svg]:size-3.5",
        placeholder && "invisible",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
