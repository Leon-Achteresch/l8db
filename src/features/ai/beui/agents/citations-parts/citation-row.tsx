import { ExternalLink } from "lucide-react";
import { CitationFavicon } from "./citation-favicon";
import { type CitationItem, citationTargetId } from "./shared";

export function CitationRow({
  citation,
  index,
  idPrefix,
}: {
  citation: CitationItem;
  index: number;
  idPrefix: string;
}) {
  const content = (
    <>
      <CitationFavicon url={citation.url} />
      <span className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="truncate text-sm font-medium text-foreground/80 transition-colors group-hover/citation:text-foreground">
          {citation.title}
        </span>
        {citation.domain ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground/60">
            {citation.domain}
          </span>
        ) : null}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        <span className="grid size-5 place-items-center rounded-md bg-foreground/[0.05] text-[10px] font-semibold tabular-nums text-muted-foreground">
          {index}
        </span>
        {citation.url ? (
          <ExternalLink className="size-3.5 text-muted-foreground/40 transition-colors group-hover/citation:text-muted-foreground" />
        ) : null}
      </span>
    </>
  );
  const className =
    "group/citation flex items-center gap-2 rounded-md px-1.5 py-1 outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const id = citationTargetId(idPrefix, citation.id);
  return citation.url ? (
    <a id={id} href={citation.url} target="_blank" rel="noreferrer noopener" className={className}>
      {content}
    </a>
  ) : (
    <div id={id} className={className}>
      {content}
    </div>
  );
}
