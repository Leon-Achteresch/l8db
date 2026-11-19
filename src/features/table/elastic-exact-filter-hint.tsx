import { InfoIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useActiveConnection } from "@/lib/connections";
import type { DatabaseKind, DetailedColumnInfo } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { keywordFilterHint } from "@/lib/keyword-filter-hint";

export function ElasticExactFilterHint({
  column,
  operator,
  kind,
}: {
  column?: DetailedColumnInfo;
  operator: string;
  kind?: DatabaseKind | null;
}) {
  const active = useActiveConnection();
  const feature = useNewFeatureVisibility<HTMLButtonElement>("table.filter.keyword-limit");
  const hint = keywordFilterHint(kind === undefined ? active?.kind : kind, column, operator);
  if (!hint) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        ref={feature.ref}
        type="button"
        className="flex min-w-0 w-full items-center gap-1.5 text-left text-2xs text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-ring cursor-help"
        aria-label={`${hint.summary}. ${hint.details}`}
      >
        <InfoIcon className="size-3 shrink-0" />
        <span className="truncate">{hint.summary}</span>
        {feature.isNew && <NewBadge />}
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">{hint.details}</TooltipContent>
    </Tooltip>
  );
}
