import { AppWindow } from "lucide-react";
import { NewBadge } from "@/components/new-badge";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function OpenInWindowMenuItem({ onSelect }: { onSelect: () => void }) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("connections.open-window");
  return (
    <DropdownMenuItem ref={feature.ref} onSelect={onSelect}>
      <AppWindow className="size-3.5" />
      In neuem Fenster öffnen
      {feature.isNew && <NewBadge className="ml-auto" />}
    </DropdownMenuItem>
  );
}
