import { LoaderIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

export function TransferSchemaList({
  schemas,
  loading,
  selected,
  onChange,
}: {
  schemas: string[];
  loading: boolean;
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  if (loading)
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <LoaderIcon className="size-3.5 animate-spin" />
        Schemas werden geladen…
      </p>
    );
  if (schemas.length === 0)
    return <p className="text-xs text-muted-foreground">Keine Schemas gefunden.</p>;
  const all = schemas.every((schema) => selected.includes(schema));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <Label className="text-xs">Schemas</Label>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onChange(all ? [] : schemas)}
        >
          {all ? "Keine" : "Alle"}
        </button>
      </div>
      <div className="flex max-h-48 flex-col gap-1.5 overflow-y-auto rounded-md border bg-background p-2">
        {schemas.map((schema) => (
          <div key={schema} className="flex items-center gap-2 text-xs">
            <Checkbox
              id={`transfer-schema-${schema}`}
              checked={selected.includes(schema)}
              onCheckedChange={(checked) =>
                onChange(
                  checked
                    ? schemas.filter((entry) => entry === schema || selected.includes(entry))
                    : selected.filter((entry) => entry !== schema),
                )
              }
            />
            <label htmlFor={`transfer-schema-${schema}`} className="truncate font-mono">
              {schema}
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
