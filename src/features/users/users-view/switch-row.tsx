import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export function SwitchRow({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-sm">{label}</Label>
      <Switch size="sm" checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}
