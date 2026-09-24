import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

interface BackupOptionSwitchProps {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

export function BackupOptionSwitch({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: BackupOptionSwitchProps) {
  return (
    <div className="flex items-start gap-2">
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
      <div className="grid gap-0.5">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}
