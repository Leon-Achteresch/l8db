import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface BackupSegmentsProps<T extends string> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  disabled?: boolean;
  onChange: (value: T) => void;
}

export function BackupSegments<T extends string>({
  label,
  value,
  options,
  disabled,
  onChange,
}: BackupSegmentsProps<T>) {
  return (
    <Tabs value={value} onValueChange={(next) => onChange(next as T)} className="gap-0">
      <TabsList aria-label={label} className="group-data-horizontal/tabs:h-8">
        {options.map((option) => (
          <TabsTrigger
            key={option.value}
            value={option.value}
            disabled={disabled}
            className="flex-none px-2.5 text-xs"
          >
            {option.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
