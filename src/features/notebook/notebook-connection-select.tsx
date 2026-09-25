import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useConnectionsStore } from "@/lib/connections";
import { cn } from "@/lib/utils";

const INHERIT = "__inherit__";

export function NotebookConnectionSelect({
  value,
  onChange,
  inheritLabel,
  label,
  className,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  inheritLabel: string;
  label: string;
  className?: string;
}) {
  const connections = useConnectionsStore((state) => state.connections);
  const known = value && connections.some((c) => c.id === value) ? value : INHERIT;
  return (
    <Select value={known} onValueChange={(next) => onChange(next === INHERIT ? null : next)}>
      <SelectTrigger size="sm" aria-label={label} className={cn("h-7 w-48 text-xs", className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>
        {connections.map((connection) => (
          <SelectItem key={connection.id} value={connection.id}>
            <span className="truncate">{connection.name}</span>
            {connection.readOnly && (
              <span className="ml-auto pl-2 text-[10px] text-muted-foreground">nur lesen</span>
            )}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
