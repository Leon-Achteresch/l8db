import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type CsvColumnMapping, type ImportTargetColumn, isRequiredColumn } from "@/lib/csv-import";

const NO_TARGET = "__skip__";

interface CsvMappingTableProps {
  headers: string[];
  sampleRow: (string | null)[] | undefined;
  mappings: CsvColumnMapping[];
  targets: ImportTargetColumn[];
  onChange: (csvIndex: number, target: string | null) => void;
}

function targetHint(column: ImportTargetColumn): string {
  const flags: string[] = [column.data_type];
  if (!column.is_nullable) flags.push("NOT NULL");
  if (column.has_default) flags.push("Default");
  if (column.is_identity) flags.push("Identity");
  if (column.is_generated) flags.push("generiert");
  return flags.join(" · ");
}

export function CsvMappingTable({
  headers,
  sampleRow,
  mappings,
  targets,
  onChange,
}: CsvMappingTableProps) {
  const usedTargets = new Set(mappings.map((m) => m.target).filter(Boolean) as string[]);

  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full border-collapse text-xs">
        <thead className="bg-muted/60">
          <tr>
            <th className="border-b px-2 py-1 text-left font-medium">CSV-Spalte</th>
            <th className="border-b px-2 py-1 text-left font-medium">Beispielwert</th>
            <th className="border-b px-2 py-1 text-left font-medium">Zielspalte</th>
          </tr>
        </thead>
        <tbody>
          {headers.map((header, index) => {
            const mapping = mappings.find((m) => m.csvIndex === index);
            const value = mapping?.target ?? NO_TARGET;
            const sample = sampleRow?.[index] ?? null;
            return (
              <tr key={index} className="odd:bg-muted/20">
                <td className="px-2 py-1 font-mono whitespace-nowrap">{header}</td>
                <td className="max-w-48 truncate px-2 py-1 font-mono text-muted-foreground">
                  {sample === null ? "NULL" : sample === "" ? '""' : sample}
                </td>
                <td className="px-2 py-1">
                  <Select
                    value={value}
                    onValueChange={(next) => onChange(index, next === NO_TARGET ? null : next)}
                  >
                    <SelectTrigger size="sm" className="w-full min-w-56">
                      <SelectValue placeholder="Auslassen" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TARGET}>Auslassen</SelectItem>
                      {targets.map((target) => (
                        <SelectItem
                          key={target.name}
                          value={target.name}
                          disabled={
                            target.is_generated ||
                            (usedTargets.has(target.name) && target.name !== mapping?.target)
                          }
                        >
                          <span className="flex items-center gap-2">
                            <span className="font-mono">{target.name}</span>
                            <span className="text-[10px] text-muted-foreground">
                              {targetHint(target)}
                            </span>
                            {isRequiredColumn(target) && (
                              <Badge variant="outline" className="text-[10px]">
                                Pflicht
                              </Badge>
                            )}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
