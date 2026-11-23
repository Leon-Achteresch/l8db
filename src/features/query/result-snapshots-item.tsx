import { CameraIcon } from "lucide-react";
import { IconMenuItem } from "@/components/icon-menu/icon-menu-item";
import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export function ResultSnapshotsItem({ onSelect }: { onSelect: () => void }) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("query.results.snapshots");
  return (
    <IconMenuItem
      data-feature="query.results.snapshots"
      ref={feature.ref}
      icon={<CameraIcon />}
      label="Ergebnisstände"
      onSelect={onSelect}
    >
      {feature.isNew && <NewBadge className="absolute -right-1 -top-1" />}
    </IconMenuItem>
  );
}
