import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface VersioningSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}

export function VersioningSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: VersioningSelectProps) {
  return (
    <Select
      value={value || options.some((option) => option.value === "") ? `selection:${value}` : ""}
      onValueChange={(next) => onChange(next.slice(10))}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={label}
        className="h-9 w-full min-w-0 rounded-lg border-0 bg-muted/50 text-xs shadow-none dark:bg-muted/40"
      >
        <SelectValue placeholder={placeholder ?? label} />
      </SelectTrigger>
      <SelectContent searchable className="rounded-xl shadow-lg shadow-black/5">
        {options.map((option) => (
          <SelectItem key={option.value} value={`selection:${option.value}`} className="text-xs">
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
