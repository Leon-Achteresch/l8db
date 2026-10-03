import { Globe2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentSearchResult } from "../types";

export function SearchResultRow({ result }: { result: AgentSearchResult }) {
  const content = (
    <>
      <span
        aria-hidden="true"
        className="grid size-5 shrink-0 place-items-center text-muted-foreground"
      >
        {result.icon ?? <Globe2 className="size-3" strokeWidth={2} />}
      </span>
      <span className="min-w-0 truncate font-medium text-foreground/90">{result.title}</span>
      {result.domain ? (
        <span className="min-w-0 truncate text-muted-foreground/55">{result.domain}</span>
      ) : null}
    </>
  );
  const className = cn(
    "flex min-h-7 items-center gap-2 rounded-md px-1.5 py-1 text-left outline-none transition-colors",
    result.url && "focus-visible:ring-2 focus-visible:ring-ring",
  );
  return result.url ? (
    <a href={result.url} className={className}>
      {content}
    </a>
  ) : (
    <div className={className}>{content}</div>
  );
}
