import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function JoinColumnPick({
  value,
  columns,
  label,
  onChange,
}: {
  value: string;
  columns: string[];
  label: string;
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger size="sm" aria-label={label} className="h-8 min-w-0 flex-1 text-xs">
        <SelectValue placeholder="Spalte" />
      </SelectTrigger>
      <SelectContent searchable>
        {columns.map((column) => (
          <SelectItem key={column} value={column}>
            {column}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
