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
import { CSV_DELIMITERS, CSV_QUOTES, type CsvLineEnding, type CsvOptions } from "@/lib/export";

interface CsvOptionsFieldsProps {
  options: CsvOptions;
  update: <K extends keyof CsvOptions>(key: K, value: CsvOptions[K]) => void;
}

export function CsvOptionsFields({ options, update }: CsvOptionsFieldsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="grid gap-1.5">
        <Label htmlFor="csv-delimiter">Trennzeichen</Label>
        <Select value={options.delimiter} onValueChange={(value) => update("delimiter", value)}>
          <SelectTrigger id="csv-delimiter" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CSV_DELIMITERS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="csv-quote">Quote-Zeichen</Label>
        <Select value={options.quote} onValueChange={(value) => update("quote", value)}>
          <SelectTrigger id="csv-quote" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CSV_QUOTES.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="csv-line-ending">Zeilenende</Label>
        <Select
          value={options.lineEnding}
          onValueChange={(value) => update("lineEnding", value as CsvLineEnding)}
        >
          <SelectTrigger id="csv-line-ending" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={"\n"}>LF (Unix)</SelectItem>
            <SelectItem value={"\r\n"}>CRLF (Windows)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="csv-null">NULL-Darstellung</Label>
        <Input
          id="csv-null"
          value={options.nullText}
          placeholder="leer"
          onChange={(event) => update("nullText", event.target.value)}
        />
      </div>

      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <Label htmlFor="csv-header">Kopfzeile</Label>
        <Switch
          id="csv-header"
          checked={options.header}
          onCheckedChange={(checked) => update("header", checked)}
          aria-label="Kopfzeile"
        />
      </div>

      <div className="flex items-center justify-between rounded-md border px-3 py-2">
        <Label htmlFor="csv-bom">UTF-8-BOM</Label>
        <Switch
          id="csv-bom"
          checked={options.bom}
          onCheckedChange={(checked) => update("bom", checked)}
          aria-label="UTF-8-BOM"
        />
      </div>
    </div>
  );
}
