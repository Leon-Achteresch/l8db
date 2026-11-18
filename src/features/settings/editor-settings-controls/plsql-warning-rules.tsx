import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PlsqlWarningLevel, PlsqlWarningRules } from "@/lib/settings";
import { Row } from "./row";
import type { Store } from "./types";
import { WarningNumbersInput } from "./warning-numbers-input";

const CATEGORIES = [
  { key: "severe", label: "Schwer" },
  { key: "performance", label: "Performance" },
  { key: "informational", label: "Info" },
] as const;

const LEVELS: { value: PlsqlWarningLevel; label: string }[] = [
  { value: "enable", label: "Melden" },
  { value: "error", label: "Fehler" },
  { value: "disable", label: "Aus" },
];

export function PlsqlWarningRulesControls({ store, compact }: { store: Store; compact: boolean }) {
  const rules = store.oraclePlsqlWarningRules;
  const update = (patch: Partial<PlsqlWarningRules>) =>
    store.setOraclePlsqlWarningRules({ ...rules, ...patch });
  return (
    <>
      <Row
        settingId="editor-plsql-warning-levels"
        featureId="settings.editor.plsql-warning-rules"
        compact={compact}
      >
        <div className="flex gap-1.5">
          {CATEGORIES.map((category) => (
            <Select
              key={category.key}
              value={rules[category.key]}
              onValueChange={(value) => update({ [category.key]: value as PlsqlWarningLevel })}
            >
              <SelectTrigger size="sm" className="h-8 w-32 text-xs" aria-label={category.label}>
                <span className="text-muted-foreground">{category.label}</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEVELS.map((level) => (
                  <SelectItem key={level.value} value={level.value}>
                    {level.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ))}
        </div>
      </Row>
      <WarningNumbersInput
        settingId="editor-plsql-warning-ignore"
        compact={compact}
        value={rules.ignore}
        placeholder="7203"
        label="Ignorierte Warnungen"
        onCommit={(ignore) => update({ ignore })}
      />
      <WarningNumbersInput
        settingId="editor-plsql-warning-errors"
        compact={compact}
        value={rules.error}
        placeholder="6009"
        label="Warnungen als Fehler"
        onCommit={(error) => update({ error })}
      />
    </>
  );
}
