import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { CsvParseResult } from "@/lib/csv-import";
import { DELIMITER_OPTIONS, QUOTE_OPTIONS } from "./constants";
import type { CsvImportState } from "./use-csv-import";

type CsvParseOptionsProps = Pick<
  CsvImportState,
  "quote" | "setDelimiter" | "setQuote" | "setHasHeader" | "emptyField" | "setEmptyField"
> & {
  parsed: CsvParseResult;
};

export function CsvParseOptions({
  parsed,
  quote,
  setDelimiter,
  setQuote,
  setHasHeader,
  emptyField,
  setEmptyField,
}: CsvParseOptionsProps) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Trennzeichen</Label>
        <Select value={parsed.delimiter} onValueChange={setDelimiter}>
          <SelectTrigger size="sm" className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DELIMITER_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-xs text-muted-foreground">Anführungszeichen</Label>
        <Select value={quote} onValueChange={setQuote}>
          <SelectTrigger size="sm" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {QUOTE_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2 pb-2">
        <Switch
          id="csv-header"
          checked={parsed.hasHeader}
          onCheckedChange={(checked) => setHasHeader(checked)}
        />
        <Label htmlFor="csv-header" className="text-xs">
          Erste Zeile ist Kopfzeile
        </Label>
      </div>
      <div className="flex items-center gap-2 pb-2">
        <Switch
          id="csv-empty-null"
          checked={emptyField === "null"}
          onCheckedChange={(checked) => setEmptyField(checked ? "null" : "empty")}
        />
        <Label htmlFor="csv-empty-null" className="text-xs">
          Leere Felder als NULL
        </Label>
      </div>
    </div>
  );
}
