import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function SelectRowLimit() {
  const { ref, isNew } = useNewFeatureVisibility<HTMLSpanElement>("query.select-row-limit");
  return (
    <span
      ref={ref}
      className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
      title="SELECT liefert standardmäßig maximal 1.000 Zeilen. Ein explizites LIMIT, TOP oder FETCH im SQL überschreibt diesen Standard."
    >
      SELECT-Standard: 1.000 Zeilen
      {isNew && <NewBadge />}
    </span>
  );
}
