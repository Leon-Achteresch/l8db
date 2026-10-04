import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { Variable } from "@/lib/db/automation";

export function VariableDefaultInput({
  variable,
  onChange,
  invalid,
  label,
}: {
  variable: Variable;
  onChange: (value: string) => void;
  invalid: boolean;
  label: string;
}) {
  if (variable.kind === "boolean")
    return (
      <div className="flex h-8 items-center gap-2">
        <Switch
          checked={variable.defaultValue === "true"}
          onCheckedChange={(checked) => onChange(checked ? "true" : "false")}
          aria-label={label}
        />
        <span className="text-xs text-muted-foreground">
          {variable.defaultValue === "true" ? "Ja" : "Nein"}
        </span>
      </div>
    );
  if (variable.kind === "choice")
    return (
      <Select
        value={variable.defaultValue || "__none"}
        onValueChange={(value) => onChange(value === "__none" ? "" : value)}
      >
        <SelectTrigger aria-label={label} className="h-8 w-full rounded-lg text-[13px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none">Kein Standard</SelectItem>
          {variable.choices.map((choice) => (
            <SelectItem key={choice} value={choice}>
              {choice}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  return (
    <Input
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={variable.defaultValue}
      inputMode={variable.kind === "number" ? "decimal" : undefined}
      placeholder={variable.kind === "date" ? "JJJJ-MM-TT oder ${date-1d}" : "leer = Pflicht"}
      onChange={(event) => onChange(event.target.value)}
      className="h-8 text-[13px]"
    />
  );
}
