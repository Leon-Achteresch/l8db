import { cn } from "@/lib/utils";
import { type CitationProps, citationTargetId } from "./shared";

export function Citation({ citationId, index, idPrefix, className }: CitationProps) {
  return (
    <a
      href={`#${citationTargetId(idPrefix, citationId)}`}
      aria-label={`View citation ${index}`}
      className={cn(
        "mx-0.5 inline-flex min-w-4 -translate-y-0.5 items-center justify-center rounded-md bg-muted/60 px-1 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground no-underline outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {index}
    </a>
  );
}
