import { ArrowRightIcon } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export function TransferSchemas({
  schemas,
  existing,
  selected,
  mapping,
  onToggle,
  onSelectAll,
  onMap,
}: {
  schemas: string[];
  existing: string[];
  selected: string[];
  mapping: Record<string, string>;
  onToggle: (schema: string) => void;
  onSelectAll: (value: string[]) => void;
  onMap: (schema: string, target: string) => void;
}) {
  const all = schemas.length > 0 && schemas.every((schema) => selected.includes(schema));
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-4 items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Schemas
        </span>
        {schemas.length > 1 && (
          <button
            type="button"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => onSelectAll(all ? [] : schemas)}
          >
            {all ? "Keine" : "Alle"}
          </button>
        )}
      </div>
      <datalist id="transfer-target-schemas">
        {existing.map((schema) => (
          <option key={schema} value={schema} />
        ))}
      </datalist>
      <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {schemas.map((schema) => {
          const checked = selected.includes(schema);
          const target = (mapping[schema] ?? "").trim() || schema;
          const isNew = existing.length > 0 && !existing.includes(target);
          return (
            <li
              key={schema}
              className={cn(
                "grid min-h-9 grid-cols-[auto_1fr] items-center gap-x-3 rounded-xl px-3 transition-colors",
                checked ? "bg-primary/5" : "hover:bg-muted/60",
              )}
            >
              <Checkbox
                id={`transfer-schema-${schema}`}
                checked={checked}
                onCheckedChange={() => onToggle(schema)}
              />
              <div className="grid min-w-0 grid-cols-[1fr_auto_1fr] items-center gap-2 py-1.5">
                <label
                  htmlFor={`transfer-schema-${schema}`}
                  className="min-w-0 cursor-pointer truncate font-mono text-sm"
                >
                  {schema}
                </label>
                {checked ? (
                  <>
                    <ArrowRightIcon className="size-3.5 text-muted-foreground" />
                    <div className="flex min-w-0 items-center gap-2">
                      <Input
                        className="h-7 min-w-0 flex-1 rounded-lg bg-background font-mono text-xs"
                        list="transfer-target-schemas"
                        aria-label={`Zielschema für ${schema}`}
                        placeholder={schema}
                        value={mapping[schema] ?? ""}
                        onChange={(event) => onMap(schema, event.target.value)}
                      />
                      {isNew && (
                        <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                          neu
                        </span>
                      )}
                    </div>
                  </>
                ) : (
                  <span className="col-span-2" />
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
