import { AppWindow } from "lucide-react";
import { IconMenuItem } from "@/components/icon-menu";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function OpenInWindowMenuItem({ onSelect }: { onSelect: () => void }) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("connections.open-window");
  return (
    <IconMenuItem
      ref={feature.ref}
      icon={<AppWindow />}
      label="In neuem Fenster öffnen"
      onSelect={onSelect}
    >
      {feature.isNew && (
        <span className="absolute top-1 right-1 size-1.5 rounded-full bg-primary" />
      )}
    </IconMenuItem>
  );
}
