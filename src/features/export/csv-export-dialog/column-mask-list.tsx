import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { type ColumnMask, DEFAULT_MASK_TEXT, type MaskMode } from "@/lib/export";

interface ColumnMaskListProps {
  columns: string[];
  maskFor: (column: string) => ColumnMask | null;
  setMaskMode: (column: string, mode: "none" | MaskMode) => void;
  setMaskText: (column: string, text: string) => void;
}

export function ColumnMaskList({
  columns,
  maskFor,
  setMaskMode,
  setMaskText,
}: ColumnMaskListProps) {
  return (
    <div className="grid gap-1.5">
      <Label>Spaltenmaskierung</Label>
      <div className="max-h-40 space-y-1.5 overflow-auto rounded-md border p-2">
        {columns.map((column) => {
          const mask = maskFor(column);
          return (
            <div key={column} className="flex items-center gap-2">
              <span className="flex-1 truncate font-mono text-xs">{column}</span>
              <Select
                value={mask?.mode ?? "none"}
                onValueChange={(value) => setMaskMode(column, value as "none" | MaskMode)}
              >
                <SelectTrigger size="sm" className="w-32" aria-label={`Maskierung ${column}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Original</SelectItem>
                  <SelectItem value="text">Fester Text</SelectItem>
                  <SelectItem value="null">NULL</SelectItem>
                </SelectContent>
              </Select>
              <Input
                className="w-28"
                value={mask?.mode === "text" ? (mask.text ?? "") : ""}
                disabled={mask?.mode !== "text"}
                placeholder={DEFAULT_MASK_TEXT}
                aria-label={`Maskentext ${column}`}
                onChange={(event) => setMaskText(column, event.target.value)}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
