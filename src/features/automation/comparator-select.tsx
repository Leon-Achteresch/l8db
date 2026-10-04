import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { COMPARATOR_LABELS } from "@/lib/automation/labels";
import type { Comparator } from "@/lib/db/automation";

interface Props {
  value: Comparator;
  onChange: (value: Comparator) => void;
  options?: Comparator[];
  label?: string;
  id?: string;
}

export function ComparatorSelect({
  value,
  onChange,
  options = Object.keys(COMPARATOR_LABELS) as Comparator[],
  label = "Vergleich",
  id,
}: Props) {
  return (
    <Select value={value} onValueChange={(next) => onChange(next as Comparator)}>
      <SelectTrigger id={id} aria-label={label} className="w-full min-w-0 rounded-lg">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((entry) => (
          <SelectItem key={entry} value={entry}>
            {COMPARATOR_LABELS[entry]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
