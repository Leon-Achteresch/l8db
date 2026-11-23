import { ListTreeIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useActiveConnection } from "@/lib/connections";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { FilterGroupingContent } from "./filter-grouping-content";

export function FilterGroupingPreview({
  sql,
  columns,
  stateKey,
  compact,
}: {
  sql: string;
  columns: string[];
  stateKey?: string;
  compact?: boolean;
}) {
  const connection = useActiveConnection();
  const postgres = connection?.kind === "postgres";
  const feature = useNewFeatureVisibility<HTMLButtonElement>(
    postgres ? "table.filter.grouping" : undefined,
  );
  return (
    <Popover key={JSON.stringify([connection?.id, connection?.kind, stateKey])}>
      <PopoverTrigger asChild>
        <Button
          ref={feature.ref}
          type="button"
          size={compact ? "icon-xs" : "xs"}
          variant="ghost"
          className="relative shrink-0"
          aria-label="Gruppierung lesen"
          title="Gruppierung lesen"
        >
          <ListTreeIcon />
          {compact ? null : "Gruppierung lesen"}
          {feature.isNew ? <NewBadge className="absolute -top-1.5 -right-2" /> : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="Logische Gruppierung"
        align="end"
        className="max-h-[min(24rem,var(--radix-popover-content-available-height))] w-[min(27rem,calc(100vw-2rem))] gap-2 p-3 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <FilterGroupingContent sql={sql} columns={columns} postgres={postgres} />
      </PopoverContent>
    </Popover>
  );
}
