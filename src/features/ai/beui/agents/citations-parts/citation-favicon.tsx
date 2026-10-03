import { Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";
export function CitationFavicon({ className }: { url?: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn("grid size-5 shrink-0 place-items-center text-muted-foreground", className)}
    >
      <Globe2 className="size-3.5" />
    </span>
  );
}
