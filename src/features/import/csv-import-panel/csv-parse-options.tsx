import { SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
    <div className="flex items-center gap-2">
      <Select value={parsed.delimiter} onValueChange={setDelimiter}>
        <SelectTrigger size="sm" className="w-auto gap-1.5 text-xs" aria-label="Trennzeichen">
          <span className="text-muted-foreground">Trenner</span>
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
      <div className="flex items-center gap-1.5">
        <Switch
          id="csv-header"
          size="sm"
          checked={parsed.hasHeader}
          onCheckedChange={(checked) => setHasHeader(checked)}
        />
        <Label htmlFor="csv-header" className="text-xs font-normal">
          Kopfzeile
        </Label>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label="Weitere Leseoptionen">
            <SlidersHorizontalIcon />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 gap-3">
          <div className="grid gap-1">
            <Label className="text-xs text-muted-foreground">Anführungszeichen</Label>
            <Select value={quote} onValueChange={setQuote}>
              <SelectTrigger size="sm" className="w-full text-xs">
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
          <div className="flex items-center gap-2">
            <Switch
              id="csv-empty-null"
              size="sm"
              checked={emptyField === "null"}
              onCheckedChange={(checked) => setEmptyField(checked ? "null" : "empty")}
            />
            <Label htmlFor="csv-empty-null" className="text-xs font-normal">
              Leere Felder als NULL
            </Label>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
