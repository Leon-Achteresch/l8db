import { CopyPlus } from "lucide-react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { DuplicateStrategy } from "@/lib/connection-export";

interface Props {
  count: number;
  value: DuplicateStrategy;
  onChange: (value: DuplicateStrategy) => void;
}

export function DuplicateStrategyField({ count, value, onChange }: Props) {
  return (
    <fieldset className="rounded-md border px-3 py-2">
      <legend className="px-1 text-xs font-medium">Dubletten ({count})</legend>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as DuplicateStrategy)}
        className="gap-1.5"
      >
        <label className="flex items-center gap-2 text-xs">
          <RadioGroupItem value="skip" id="import-dup-skip" />
          Überspringen, bestehendes Profil behalten
        </label>
        <label className="flex items-center gap-2 text-xs">
          <RadioGroupItem value="copy" id="import-dup-copy" />
          <CopyPlus className="size-3.5" />
          Als Kopie mit neuer ID übernehmen
        </label>
      </RadioGroup>
    </fieldset>
  );
}
