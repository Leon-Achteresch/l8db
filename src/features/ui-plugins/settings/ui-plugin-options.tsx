import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { OptionSpec, OptionValues } from "@/lib/ui-plugins/api";
import { useUiPluginSettings } from "@/lib/ui-plugins/settings";
import { UiPluginNumberInput } from "./ui-plugin-number-input";

export function UiPluginOptions({
  id,
  specs,
  values,
}: {
  id: string;
  specs: Readonly<Record<string, OptionSpec>>;
  values: OptionValues;
}) {
  const setOption = useUiPluginSettings((state) => state.setOption);
  const resetOptions = useUiPluginSettings((state) => state.resetOptions);
  const entries = Object.entries(specs);
  if (entries.length === 0) return null;
  return (
    <fieldset className="space-y-2 rounded-xl bg-muted/40 p-3">
      <legend className="sr-only">Einstellungen</legend>
      {entries.map(([key, spec]) => {
        const inputId = `ui-plugin-${id}-${key}`;
        const value = values[key];
        return (
          <div
            key={key}
            className="grid items-center gap-x-4 gap-y-1 @min-[30rem]:grid-cols-[minmax(0,1fr)_14rem]"
          >
            <label htmlFor={inputId} className="min-w-0 text-xs">
              <span className="font-medium">{spec.label}</span>
              {spec.description && (
                <span className="block text-muted-foreground">{spec.description}</span>
              )}
            </label>
            {spec.type === "boolean" ? (
              <Switch
                id={inputId}
                checked={value === true}
                onCheckedChange={(checked) => setOption(id, key, checked)}
                className="justify-self-end"
              />
            ) : spec.type === "select" ? (
              <Select value={String(value)} onValueChange={(next) => setOption(id, key, next)}>
                <SelectTrigger id={inputId} size="sm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {spec.choices.map((choice) => {
                    const option =
                      typeof choice === "string" ? { value: choice, label: choice } : choice;
                    return (
                      <SelectItem key={option.value} value={option.value} className="text-xs">
                        {option.label}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            ) : spec.type === "number" ? (
              <UiPluginNumberInput
                id={inputId}
                value={Number(value)}
                min={spec.min}
                max={spec.max}
                step={spec.step}
                onChange={(next) => setOption(id, key, next)}
              />
            ) : (
              <Input
                id={inputId}
                className="h-8 text-xs"
                value={String(value)}
                placeholder={spec.placeholder}
                maxLength={500}
                onChange={(event) => setOption(id, key, event.currentTarget.value)}
              />
            )}
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => resetOptions(id)}
        className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >
        Auf Standard zurücksetzen
      </button>
    </fieldset>
  );
}
