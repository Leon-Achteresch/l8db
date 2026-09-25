import type { Ref } from "react";
import { cn } from "@/lib/utils";

export function VimStatusLine({
  ref,
  className,
}: {
  ref: Ref<HTMLDivElement>;
  className?: string;
}) {
  return (
    <div
      ref={ref}
      role="status"
      aria-label="Vim-Modus"
      className={cn(
        "h-6 shrink-0 overflow-hidden border-t bg-muted/40 px-3 font-mono text-[11px] leading-6 whitespace-nowrap text-muted-foreground [&_input]:ml-0.5 [&_input]:w-[60%] [&_input]:border-0 [&_input]:bg-transparent [&_input]:font-mono [&_input]:text-foreground [&_input]:outline-none [&_span:first-child]:font-semibold [&_span:first-child]:text-foreground",
        className,
      )}
    />
  );
}
