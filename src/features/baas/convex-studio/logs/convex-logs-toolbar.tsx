import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { LOG_LEVELS, type LogFilters, type LogLevel, type LogStatus } from "./convex-logs-buffer";

const STATUSES: { value: LogStatus; label: string }[] = [
  { value: "all", label: "Alle Status" },
  { value: "success", label: "Erfolgreich" },
  { value: "failure", label: "Fehlgeschlagen" },
  { value: "running", label: "Laufend" },
];

export function ConvexLogsToolbar({
  filters,
  identifiers,
  onChange,
}: {
  filters: LogFilters;
  identifiers: string[];
  onChange: (filters: LogFilters) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={filters.search}
        onChange={(event) => onChange({ ...filters, search: event.target.value })}
        placeholder="Logs, Fehler, Request-ID durchsuchen"
        className="h-8 w-64 text-xs"
        aria-label="Logs durchsuchen"
      />
      <Select
        value={filters.identifier}
        onValueChange={(identifier) => onChange({ ...filters, identifier })}
      >
        <SelectTrigger size="sm" className="h-8 w-56 text-xs" aria-label="Funktion">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">
            Alle Funktionen
          </SelectItem>
          {identifiers.map((identifier) => (
            <SelectItem key={identifier} value={identifier} className="font-mono text-xs">
              {identifier}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select
        value={filters.status}
        onValueChange={(status) => onChange({ ...filters, status: status as LogStatus })}
      >
        <SelectTrigger size="sm" className="h-8 w-36 text-xs" aria-label="Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((status) => (
            <SelectItem key={status.value} value={status.value} className="text-xs">
              {status.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <ToggleGroup
        type="multiple"
        variant="outline"
        size="sm"
        spacing={0}
        value={filters.levels}
        onValueChange={(levels) => onChange({ ...filters, levels: levels as LogLevel[] })}
        aria-label="Log-Level"
      >
        {LOG_LEVELS.map((level) => (
          <ToggleGroupItem key={level} value={level} className="h-8 px-2 text-[11px]">
            {level}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
