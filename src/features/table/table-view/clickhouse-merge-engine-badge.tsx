import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { ClickhouseMergeContext } from "@/lib/clickhouse-merge-engine";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function ClickhouseMergeEngineBadge({ context }: { context: ClickhouseMergeContext }) {
  const feature = useNewFeatureVisibility<HTMLButtonElement>(
    "table.structure.clickhouse-merge-engine",
  );
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          ref={feature.ref}
          type="button"
          size="xs"
          variant="secondary"
          className="relative mx-1 shrink-0 font-mono text-[10px]"
          aria-label={`Merge-Engine ${context.engine}`}
          title={context.engine}
        >
          <span className="max-w-20 truncate sm:max-w-48">{context.engine}</span>
          {feature.isNew && <NewBadge className="absolute -right-2 -top-1.5" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        aria-label="ClickHouse-Merge-Engine"
        align="end"
        className="w-[min(20rem,calc(100vw-2rem))] gap-2 p-3"
      >
        <h2 className="font-mono text-xs font-medium wrap-anywhere">{context.engine}</h2>
        <p className="text-xs leading-relaxed text-muted-foreground">{context.explanation}</p>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Die normale Vorschau und Zeilenzählung können Zeilen aus noch nicht zusammengeführten
          Datenteilen enthalten.
        </p>
      </PopoverContent>
    </Popover>
  );
}
