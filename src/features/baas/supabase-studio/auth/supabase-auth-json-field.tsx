import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { parseJsonObject } from "./supabase-auth-format";

interface Props {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

export function SupabaseAuthJsonField({ id, label, value, onChange, disabled }: Props) {
  const parsed = parseJsonObject(value);
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Textarea
        id={id}
        className="min-h-24 font-mono text-xs"
        value={value}
        spellCheck={false}
        aria-invalid={typeof parsed === "string"}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
      />
      {typeof parsed === "string" && (
        <p role="alert" className="text-xs text-destructive">
          {parsed}
        </p>
      )}
    </div>
  );
}
