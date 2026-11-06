import { GitCompareArrowsIcon } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { Button } from "@/components/ui/button";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function ResultCompareButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const feature = useNewFeatureVisibility<HTMLButtonElement>("query.result.compare");
  return (
    <Button
      ref={feature.ref}
      size="sm"
      variant={open ? "secondary" : "ghost"}
      className="h-7 gap-1.5 px-2 text-xs"
      aria-pressed={open}
      title={open ? "Zurück zum Ergebnis" : "Ergebnis mit dem vorherigen Lauf vergleichen"}
      onClick={onToggle}
    >
      <GitCompareArrowsIcon className="size-3" />
      <span className="hidden sm:inline">Vergleich</span>
      {feature.isNew && <NewBadge />}
    </Button>
  );
}
