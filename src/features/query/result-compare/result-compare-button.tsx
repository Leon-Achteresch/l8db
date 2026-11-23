import { GitCompareArrowsIcon } from "lucide-react";
import { IconMenuCheckboxItem } from "@/components/icon-menu/icon-menu-checkbox-item";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function ResultCompareButton({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("query.result.compare");
  return (
    <IconMenuCheckboxItem
      data-feature="query.result.compare"
      ref={feature.ref}
      icon={<GitCompareArrowsIcon />}
      label={open ? "Vergleich schließen" : "Mit vorherigem Lauf vergleichen"}
      checked={open}
      onCheckedChange={onToggle}
    />
  );
}
