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
    <div className="flex items-center gap-2">
      <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
        {FORMAT_LABELS[format]}
      </span>
      {format === "xlsx" && (
        <>
          <Select value={sheet ?? undefined} onValueChange={setSheet}>
            <SelectTrigger size="sm" className="w-auto gap-1.5 text-xs" aria-label="Tabellenblatt">
              <span className="text-muted-foreground">Blatt</span>
              <SelectValue placeholder="wählen…" />
            </SelectTrigger>
            <SelectContent>
              {(structured?.sheets ?? []).map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Label htmlFor="xlsx-skip-rows" className="text-xs font-normal text-muted-foreground">
            Überspringen
          </Label>
          <Input
            id="xlsx-skip-rows"
            title="Zeilen vor der Kopfzeile überspringen"
            className="h-8 w-14 text-right text-xs tabular-nums md:text-xs"
            inputMode="numeric"
            value={String(skipRows)}
            onChange={(event) => {
              const next = Number.parseInt(event.target.value, 10);
              setSkipRows(Number.isFinite(next) && next >= 0 ? next : 0);
            }}
          />
          <div className="flex items-center gap-1.5">
            <Switch
              id="xlsx-header"
              size="sm"
              checked={parsed?.hasHeader ?? true}
              onCheckedChange={(checked) => setHasHeader(checked)}
            />
            <Label htmlFor="xlsx-header" className="text-xs font-normal">
              Kopfzeile
            </Label>
          </div>
          <div className="flex items-center gap-1.5">
            <Switch
              id="xlsx-empty-null"
              size="sm"
              checked={emptyField === "null"}
              onCheckedChange={(checked) => setEmptyField(checked ? "null" : "empty")}
            />
            <Label htmlFor="xlsx-empty-null" className="text-xs font-normal">
              Leer als NULL
            </Label>
          </div>
        </>
      )}
    </div>
  );
}
