import { PlusIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MASK_MODES, type MaskMode, type MaskRule, ruleRegex } from "@/lib/masking";

interface Props {
  rules: MaskRule[];
  onChange: (rules: MaskRule[]) => void;
}

export function MaskRulesEditor({ rules, onChange }: Props) {
  const update = (index: number, patch: Partial<MaskRule>) =>
    onChange(rules.map((rule, i) => (i === index ? { ...rule, ...patch } : rule)));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="text-sm font-medium">Maskierungsregeln</legend>
      <p className="text-xs text-muted-foreground">
        Spaltenmuster (regulärer Ausdruck) mit Maskierungsfunktion. Gilt für „Maskierung anzeigen“,
        Exporte und den MCP-Server.
      </p>
      {rules.map((rule, index) => {
        const invalid = rule.pattern.trim() !== "" && ruleRegex(rule.pattern) === null;
        return (
          <div key={index} className="flex items-center gap-2">
            <Input
              className="h-8 flex-1 font-mono text-xs"
              value={rule.pattern}
              placeholder="z. B. email|telefon"
              aria-label={`Muster Regel ${index + 1}`}
              aria-invalid={invalid}
              onChange={(event) =>
                update(index, { pattern: event.target.value, name: event.target.value })
              }
            />
            <Select
              value={rule.mask ?? "partial"}
              onValueChange={(value) => update(index, { mask: value as MaskMode })}
            >
              <SelectTrigger size="sm" className="w-36" aria-label={`Funktion Regel ${index + 1}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {MASK_MODES.map((mode) => (
                  <SelectItem key={mode.value} value={mode.value}>
                    {mode.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Switch
              checked={rule.enabled}
              onCheckedChange={(enabled) => update(index, { enabled })}
              aria-label={`Regel ${index + 1} aktiv`}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label={`Regel ${index + 1} entfernen`}
              onClick={() => onChange(rules.filter((_, i) => i !== index))}
            >
              <Trash2Icon className="size-3.5" />
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() =>
          onChange([...rules, { name: "", pattern: "", enabled: true, mask: "partial" }])
        }
      >
        <PlusIcon className="size-3.5" />
        Regel hinzufügen
      </Button>
    </fieldset>
  );
}
