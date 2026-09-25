import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ConnectionSecretArea({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="grid min-w-0 gap-1">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Textarea
        id={id}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        autoComplete="off"
        className="max-h-40 min-h-20 rounded-xl bg-background/70 font-mono text-[11px]"
      />
    </div>
  );
}
