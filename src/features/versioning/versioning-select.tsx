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
  hideLabel?: boolean;
}

export function VersioningSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
  hideLabel,
}: VersioningSelectProps) {
  const select = (
    <Select
      value={value || options.some((option) => option.value === "") ? `selection:${value}` : ""}
      onValueChange={(next) => onChange(next.slice(10))}
      disabled={disabled}
    >
      <SelectTrigger aria-label={label} className="h-9 w-full min-w-0 text-xs">
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
  if (hideLabel) return select;
  return (
    <div className="min-w-0 space-y-1.5 text-xs">
      <span className="block font-medium">{label}</span>
      {select}
    </div>
  );
}
