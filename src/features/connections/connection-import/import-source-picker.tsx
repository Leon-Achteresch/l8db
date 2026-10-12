import { SegmentedControl } from "@/components/motion/segmented-control";
import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

export type ImportSource = "l8db" | "dbeaver" | "datagrip" | "navicat";

const OPTIONS: readonly { value: ImportSource; label: string }[] = [
  { value: "l8db", label: "l8db / Toad" },
  { value: "dbeaver", label: "DBeaver" },
  { value: "datagrip", label: "DataGrip" },
  { value: "navicat", label: "Navicat" },
];

interface Props {
  value: ImportSource;
  onChange: (value: ImportSource) => void;
}

export function ImportSourcePicker({ value, onChange }: Props) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("connections.import.external");
  return (
    <div ref={feature.ref} className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <SegmentedControl value={value} onChange={onChange} options={OPTIONS} label="Quelle" />
      </div>
      {feature.isNew && <NewBadge />}
    </div>
  );
}
