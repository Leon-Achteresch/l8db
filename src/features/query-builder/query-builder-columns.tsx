import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

interface QueryBuilderColumnsProps {
  title: string;
  columns: { name: string; dataType: string }[];
  selected: string[];
  loading?: boolean;
  onToggle: (column: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

export function QueryBuilderColumns({
  title,
  columns,
  selected,
  loading,
  onToggle,
  onSelectAll,
  onSelectNone,
}: QueryBuilderColumnsProps) {
  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-medium">{title}</span>
        <div className="flex items-center gap-2 text-xs">
          <button type="button" className="text-primary hover:underline" onClick={onSelectAll}>
            Alle
          </button>
          <button type="button" className="text-primary hover:underline" onClick={onSelectNone}>
            Keine
          </button>
        </div>
      </div>
      <div className="max-h-56 overflow-auto p-2">
        {loading ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">Spalten werden geladen…</p>
        ) : columns.length === 0 ? (
          <p className="px-1 py-2 text-sm text-muted-foreground">Keine Spalten vorhanden.</p>
        ) : (
          columns.map((column) => {
            const id = `${title}-${column.name}`;
            return (
              <div key={column.name} className="flex items-center gap-2 rounded px-1 py-1">
                <Checkbox
                  id={id}
                  checked={selected.includes(column.name)}
                  onCheckedChange={() => onToggle(column.name)}
                />
                <Label htmlFor={id} className="flex-1 cursor-pointer font-normal">
                  <span className="truncate">{column.name}</span>
                  <span className="ml-auto text-xs text-muted-foreground">{column.dataType}</span>
                </Label>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
