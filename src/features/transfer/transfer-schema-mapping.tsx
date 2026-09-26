import { ArrowRightIcon } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TransferSchemaMapping({
  sources,
  existing,
  mapping,
  onChange,
}: {
  sources: string[];
  existing: string[];
  mapping: Record<string, string>;
  onChange: (source: string, target: string) => void;
}) {
  if (sources.length === 0)
    return <p className="text-xs text-muted-foreground">Zuerst Quellschemas wählen.</p>;
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">Zielschemas</Label>
      <datalist id="transfer-target-schemas">
        {existing.map((schema) => (
          <option key={schema} value={schema} />
        ))}
      </datalist>
      <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto">
        {sources.map((source) => {
          const target = (mapping[source] ?? "").trim() || source;
          return (
            <div key={source} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <span className="truncate font-mono text-xs">{source}</span>
              <ArrowRightIcon className="size-3.5 text-muted-foreground" />
              <div className="flex min-w-0 flex-col">
                <Input
                  className="h-7 font-mono text-xs"
                  list="transfer-target-schemas"
                  aria-label={`Zielschema für ${source}`}
                  placeholder={source}
                  value={mapping[source] ?? ""}
                  onChange={(event) => onChange(source, event.target.value)}
                />
                {existing.length > 0 && !existing.includes(target) && (
                  <span className="text-[11px] text-muted-foreground">wird angelegt</span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
