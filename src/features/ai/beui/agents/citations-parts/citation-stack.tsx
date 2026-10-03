import { cn } from "@/lib/utils";
import { CitationFavicon } from "./citation-favicon";
import type { CitationStackProps } from "./shared";

export function CitationStack({ citations, limit = 3, className }: CitationStackProps) {
  return (
    <span aria-hidden="true" className={cn("flex -space-x-1.5", className)}>
      {citations.slice(0, limit).map((citation) => (
        <CitationFavicon
          key={citation.id}
          url={citation.url}
          className="size-6 rounded-full bg-background ring-2 ring-background"
        />
      ))}
    </span>
  );
}
