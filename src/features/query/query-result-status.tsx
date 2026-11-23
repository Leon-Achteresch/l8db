import { NewBadge } from "@/components/new-badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";

export function QueryResultStatus({
  text,
  details,
  className,
}: {
  text: string;
  details?: string;
  className?: string;
}) {
  const feature = useNewFeatureVisibility<HTMLButtonElement>("query.results.timing-scope");
  if (!details) return <span className={className}>{text}</span>;
  return (
    <Tooltip>
      <TooltipTrigger
        ref={feature.ref}
        type="button"
        className={cn(
          className,
          "cursor-help text-left hover:text-foreground focus-visible:outline focus-visible:outline-ring",
        )}
        aria-label={`${text}. ${details}`}
      >
        {text}
        {feature.isNew && <NewBadge className="ml-1" />}
      </TooltipTrigger>
      <TooltipContent className="max-w-sm">{details}</TooltipContent>
    </Tooltip>
  );
}
