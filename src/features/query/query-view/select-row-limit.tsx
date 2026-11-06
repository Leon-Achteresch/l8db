import { ListEndIcon } from "lucide-react";

import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function SelectRowLimit() {
  const { ref, isNew } = useNewFeatureVisibility<HTMLSpanElement>("query.select-row-limit");
  return (
    <span
      ref={ref}
      className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-xs text-muted-foreground"
      title="SELECT liefert standardmäßig maximal 1.000 Zeilen. Ein explizites LIMIT, TOP oder FETCH im SQL überschreibt diesen Standard."
    >
      <ListEndIcon className="size-3.5 @min-[74rem]/qtb:hidden" aria-hidden />
      <span className="hidden @min-[74rem]/qtb:inline">SELECT-Standard:</span>
      <span className="sr-only @min-[62rem]/qtb:not-sr-only">1.000 Zeilen</span>
      {isNew && <NewBadge />}
    </span>
  );
}
