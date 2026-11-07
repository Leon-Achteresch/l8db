import { SlidersHorizontalIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  | "quote"
  | "changeDelimiter"
  | "changeQuote"
  | "changeHasHeader"
  | "emptyField"
  | "setEmptyField"
  | "nullText"
  | "setNullText"
> & {
  parsed: CsvParseResult;
};

export function CsvParseOptions({
  parsed,
  quote,
  changeDelimiter,
  changeQuote,
  changeHasHeader,
  emptyField,
  setEmptyField,
  nullText,
  setNullText,
}: CsvParseOptionsProps) {
  return (
    <div className="flex items-center gap-2">
      <Select value={parsed.delimiter} onValueChange={changeDelimiter}>
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
          onCheckedChange={changeHasHeader}
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
            <Select value={quote} onValueChange={changeQuote}>
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
          <div className="grid gap-1">
            <Label htmlFor="csv-null-text" className="text-xs text-muted-foreground">
              NULL-Text
            </Label>
            <Input
              id="csv-null-text"
              className="h-8 text-xs"
              placeholder="z. B. NULL"
              value={nullText}
              onChange={(event) => setNullText(event.target.value)}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
