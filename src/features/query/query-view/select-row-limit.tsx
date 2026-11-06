import { ChevronDownIcon, ListEndIcon } from "lucide-react";

import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function SelectRowLimit() {
  const { ref, isNew } = useNewFeatureVisibility<HTMLButtonElement>("query.select-row-limit");
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          ref={ref}
          size="sm"
          variant="ghost"
          className="h-8 shrink-0 gap-1.5 px-2 text-xs text-foreground tabular-nums"
          aria-label="Zeilenlimit für SELECT: 1.000"
        >
          <ListEndIcon className="size-3.5" aria-hidden />
          <span className="sr-only @min-[62rem]/qtb:not-sr-only">Limit: 1.000</span>
          <ChevronDownIcon className="size-3 text-muted-foreground" aria-hidden />
          {isNew && <NewBadge />}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="gap-1 text-xs leading-relaxed">
        <p className="font-medium text-foreground">Zeilenlimit: 1.000</p>
        <p className="text-muted-foreground">
          SELECT liefert standardmäßig maximal 1.000 Zeilen. Ein explizites LIMIT, TOP oder FETCH im
          SQL überschreibt diesen Standard.
        </p>
      </PopoverContent>
    </Popover>
  );
}
