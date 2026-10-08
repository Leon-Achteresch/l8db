import { CopyPlusIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface CreateTableTemplatePopoverProps {
  tables: string[];
  value: string;
  loading: boolean;
  notes: string[];
  onApply: (table: string) => void;
}

export function CreateTableTemplatePopover({
  tables,
  value,
  loading,
  notes,
  onApply,
}: CreateTableTemplatePopoverProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 text-xs" disabled={tables.length === 0}>
          <CopyPlusIcon className="size-3.5" />
          Spalten übernehmen
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2 p-3">
        <div className="text-xs font-medium">Spalten aus bestehender Tabelle</div>
        <Select value={value} onValueChange={onApply} disabled={loading}>
          <SelectTrigger size="sm" className="h-8 w-full font-mono text-xs">
            <SelectValue placeholder="Vorlagentabelle wählen…" />
          </SelectTrigger>
          <SelectContent searchable>
            {tables.map((table) => (
              <SelectItem key={table} value={table} className="font-mono text-xs">
                {table}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {notes.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-muted-foreground">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
