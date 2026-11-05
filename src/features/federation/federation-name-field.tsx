import { useMemo, useState } from "react";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox";
import { federationNameOptions } from "./federation-state";

const same = (value: string) => value;

export function FederationNameField({
  value,
  options,
  label,
  disabled,
  onChange,
  allowCustom = true,
  display = same,
}: {
  value: string;
  options: string[];
  label: string;
  disabled: boolean;
  onChange: (value: string) => void;
  allowCustom?: boolean;
  display?: (value: string) => string;
}) {
  const [query, setQuery] = useState<string | null>(null);
  const matches = useMemo(
    () => federationNameOptions(options, query ?? "", display),
    [options, query, display],
  );

  return (
    <Combobox
      items={matches}
      value={value || null}
      inputValue={query ?? display(value)}
      filter={null}
      onInputValueChange={(text, details) => {
        if (details.reason !== "input-change") return;
        setQuery(text);
        if (allowCustom) onChange(text);
      }}
      onValueChange={(next) => {
        onChange(next ?? "");
        setQuery(null);
      }}
      onOpenChange={(open) => {
        if (!open) setQuery(null);
      }}
    >
      <ComboboxInput
        aria-label={label}
        placeholder={label}
        disabled={disabled}
        maxLength={512}
        className="min-w-0 flex-1"
      />
      <ComboboxContent>
        <ComboboxEmpty>
          {allowCustom ? "Name kann direkt eingegeben werden." : "Keine passende Verbindung."}
        </ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              <span className="truncate">{display(item)}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
