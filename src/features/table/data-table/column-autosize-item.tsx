import { NewBadge } from "@/components/new-badge";
import { ContextMenuItem } from "@/components/ui/context-menu";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function ColumnAutosizeItem({ onSelect }: { onSelect: () => void }) {
  const { ref, isNew } = useNewFeatureVisibility<HTMLDivElement>("table.rows.column-autosize");
  return (
    <ContextMenuItem ref={ref} onSelect={onSelect}>
      An Inhalt anpassen
      {isNew && <NewBadge />}
    </ContextMenuItem>
  );
}
