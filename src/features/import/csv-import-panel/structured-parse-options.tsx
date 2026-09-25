import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { CsvImportState } from "./use-csv-import";

const FORMAT_LABELS = {
  csv: "CSV",
  json: "JSON (Array von Objekten)",
  ndjson: "NDJSON (ein Objekt pro Zeile)",
  xlsx: "Excel-Arbeitsmappe",
  parquet: "Parquet",
} as const;

type StructuredParseOptionsProps = Pick<
  CsvImportState,
  | "format"
  | "structured"
  | "sheet"
  | "setSheet"
  | "skipRows"
  | "setSkipRows"
  | "parsed"
  | "setHasHeader"
  | "emptyField"
  | "setEmptyField"
>;

export function StructuredParseOptions({
  format,
  structured,
  sheet,
  setSheet,
  skipRows,
  setSkipRows,
  parsed,
  setHasHeader,
  emptyField,
  setEmptyField,
}: StructuredParseOptionsProps) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Format</Label>
        <span className="h-8 content-center text-xs">{FORMAT_LABELS[format]}</span>
      </div>
      {format === "xlsx" && (
        <>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Tabellenblatt</Label>
            <Select value={sheet ?? undefined} onValueChange={setSheet}>
              <SelectTrigger size="sm" className="w-56" aria-label="Tabellenblatt">
                <SelectValue placeholder="Blatt wählen…" />
              </SelectTrigger>
              <SelectContent>
                {(structured?.sheets ?? []).map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="xlsx-skip-rows" className="text-xs text-muted-foreground">
              Zeilen vor der Kopfzeile überspringen
            </Label>
            <Input
              id="xlsx-skip-rows"
              className="h-8 w-24"
              inputMode="numeric"
              value={String(skipRows)}
              onChange={(event) => {
                const next = Number.parseInt(event.target.value, 10);
                setSkipRows(Number.isFinite(next) && next >= 0 ? next : 0);
              }}
            />
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch
              id="xlsx-header"
              checked={parsed?.hasHeader ?? true}
              onCheckedChange={(checked) => setHasHeader(checked)}
            />
            <Label htmlFor="xlsx-header" className="text-xs">
              Zeile ist Kopfzeile
            </Label>
          </div>
          <div className="flex items-center gap-2 pb-2">
            <Switch
              id="xlsx-empty-null"
              checked={emptyField === "null"}
              onCheckedChange={(checked) => setEmptyField(checked ? "null" : "empty")}
            />
            <Label htmlFor="xlsx-empty-null" className="text-xs">
              Leere Zellen als NULL
            </Label>
          </div>
        </>
      )}
    </div>
  );
}
