import { NewBadge } from "@/components/new-badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TransferContent } from "@/lib/db";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";

const OPTIONS: { value: TransferContent; label: string }[] = [
  { value: "all", label: "Struktur und Daten" },
  { value: "structure", label: "Nur Struktur" },
  { value: "data", label: "Nur Daten" },
];

export function TransferContentSelect({
  value,
  onChange,
}: {
  value: TransferContent;
  onChange: (value: TransferContent) => void;
}) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("transfer.content");
  return (
    <div ref={feature.ref} className="ml-auto flex items-center gap-2">
      {feature.isNew && <NewBadge />}
      <Select value={value} onValueChange={(next) => onChange(next as TransferContent)}>
        <SelectTrigger size="sm" aria-label="Umfang" className="h-8 w-44 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent align="end">
          {OPTIONS.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
