import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ExtensionDescriptor, Json } from "@/lib/extensions/contracts";

export function ExtensionConfigurationForm({
  extension,
  onChange,
}: {
  extension: ExtensionDescriptor;
  onChange: (values: Record<string, Json>) => void;
}) {
  const properties = extension.archive.manifest.contributes?.configuration ?? {};
  const set = (key: string, value: Json) => onChange({ ...extension.configuration, [key]: value });

  return (
    <div className="space-y-3">
      {Object.entries(properties).map(([key, property]) => {
        const value = extension.configuration[key] ?? property.default;
        const choices = property.enum;
        return (
          <div key={key} className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium">{property.description ?? key}</p>
              <p className="font-mono text-[11px] text-muted-foreground">{key}</p>
            </div>
            {choices ? (
              <Select
                value={String(value)}
                onValueChange={(next) =>
                  set(key, choices.find((entry) => String(entry) === next) ?? next)
                }
              >
                <SelectTrigger size="sm" aria-label={key} className="min-w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {choices.map((entry) => (
                    <SelectItem key={String(entry)} value={String(entry)}>
                      {String(entry)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : property.type === "boolean" ? (
              <Switch
                aria-label={key}
                checked={value === true}
                onCheckedChange={(checked) => set(key, checked)}
              />
            ) : (
              <Input
                key={String(value)}
                aria-label={key}
                type={property.type === "number" ? "number" : "text"}
                defaultValue={String(value)}
                className="h-8 w-48"
                onBlur={(event) => {
                  const next =
                    property.type === "number" ? Number(event.target.value) : event.target.value;
                  if (next !== value) set(key, next);
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
