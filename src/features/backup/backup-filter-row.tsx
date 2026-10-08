import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { BackupField } from "./backup-field";
import { BackupNameListInput } from "./backup-name-list-input";
import { BackupSegments } from "./backup-segments";

type FilterMode = "all" | "include" | "exclude";

interface BackupFilterRowProps {
  id: string;
  label: string;
  include: string[];
  exclude: string[];
  includeLabel?: string;
  placeholder: string;
  suggestions?: string[];
  icon?: LucideIcon;
  except?: boolean;
  disabled?: boolean;
  onChange: (include: string[], exclude: string[]) => void;
}

export function BackupFilterRow({
  id,
  label,
  include,
  exclude,
  includeLabel = "Nur",
  placeholder,
  suggestions,
  icon,
  except = true,
  disabled,
  onChange,
}: BackupFilterRowProps) {
  const [mode, setMode] = useState<FilterMode>(
    include.length ? "include" : exclude.length ? "exclude" : "all",
  );
  const pick = (next: FilterMode) => {
    setMode(next);
    if (next === "all") onChange([], []);
    if (next === "exclude") onChange([], exclude);
    if (next === "include" && !except) onChange(include, []);
  };

  return (
    <>
      <BackupField label={label} htmlFor={mode === "all" ? undefined : `${id}-${mode}`}>
        <BackupSegments
          label={label}
          value={mode}
          disabled={disabled}
          options={[
            { value: "all", label: "Alle" },
            { value: "include", label: includeLabel },
            { value: "exclude", label: "Alle außer" },
          ]}
          onChange={pick}
        />
        {mode !== "all" && (
          <BackupNameListInput
            key={mode}
            id={`${id}-${mode}`}
            label={`${label}: ${mode === "include" ? includeLabel : "Alle außer"}`}
            placeholder={placeholder}
            value={mode === "include" ? include : exclude}
            suggestions={suggestions}
            icon={icon}
            disabled={disabled}
            onChange={(value) =>
              mode === "include" ? onChange(value, exclude) : onChange(include, value)
            }
          />
        )}
      </BackupField>
      {except && mode === "include" && (
        <BackupField label="außer" htmlFor={`${id}-except`}>
          <BackupNameListInput
            id={`${id}-except`}
            label={`${label}: außer`}
            placeholder="Keine Ausnahmen"
            value={exclude}
            suggestions={suggestions}
            icon={icon}
            disabled={disabled}
            onChange={(value) => onChange(include, value)}
          />
        </BackupField>
      )}
    </>
  );
}
