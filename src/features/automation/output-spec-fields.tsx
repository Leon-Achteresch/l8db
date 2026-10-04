import { useId } from "react";
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
import { IF_EXISTS_LABELS } from "@/lib/automation/labels";
import { renderExample } from "@/lib/automation/placeholders";
import type { IfExists, OutputSpec } from "@/lib/db/automation";
import { FormRow } from "./form-row";
import { PathInput } from "./path-input";
import { optionalNumber, useFieldError } from "./step-form-context";

interface Props {
  value: OutputSpec;
  onChange: (value: OutputSpec) => void;
  extension: string;
  field?: string;
  allowAppend?: boolean;
  allowZip?: boolean;
}

function example(path: string, extension: string, timestamp: boolean): string {
  const name = renderExample(path).split(/[\\/]/).pop() || `ausgabe.${extension}`;
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot + 1) : extension;
  return `${base}${timestamp ? "-20261004-073000" : ""}.${ext}`;
}

export function OutputSpecFields({
  value,
  onChange,
  extension,
  field = "output",
  allowAppend = true,
  allowZip = true,
}: Props) {
  const timestampId = useId();
  const zipId = useId();
  const cleanupId = useId();
  const pathError = useFieldError(`${field}.path`);
  const ifExistsError = useFieldError(`${field}.ifExists`);
  const patch = (next: Partial<OutputSpec>) => onChange({ ...value, ...next });
  const cleanup = value.cleanup;

  return (
    <div className="flex flex-col gap-4">
      <FormRow
        label="Zieldatei"
        error={pathError}
        hint={
          <>
            Platzhalter wie <code className="font-mono">{"${date}"}</code> erlaubt. Beispiel:{" "}
            <span className="font-mono text-foreground/80">
              {example(value.path, extension, value.appendTimestamp)}
            </span>
          </>
        }
      >
        <PathInput
          mode="save"
          extensions={[extension]}
          value={value.path}
          placeholder={`\${output_dir}/datei.${extension}`}
          onChange={(path) => patch({ path })}
        />
      </FormRow>
      <div className="grid gap-4 @lg/step:grid-cols-2">
        <FormRow label="Wenn die Datei existiert" error={ifExistsError} bind={false}>
          <Select
            value={value.ifExists}
            onValueChange={(ifExists) => patch({ ifExists: ifExists as IfExists })}
          >
            <SelectTrigger aria-label="Wenn die Datei existiert" className="w-full rounded-lg">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(IF_EXISTS_LABELS) as IfExists[])
                .filter((entry) => allowAppend || entry !== "append")
                .map((entry) => (
                  <SelectItem key={entry} value={entry}>
                    {IF_EXISTS_LABELS[entry]}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </FormRow>
        <div className="flex flex-col justify-end gap-2.5 pb-1">
          <div className="flex items-center gap-2.5">
            <Switch
              id={timestampId}
              checked={value.appendTimestamp}
              onCheckedChange={(appendTimestamp) => patch({ appendTimestamp })}
            />
            <Label htmlFor={timestampId} className="text-[13px] font-normal">
              Zeitstempel anhängen
            </Label>
          </div>
          {allowZip && (
            <div className="flex items-center gap-2.5">
              <Switch id={zipId} checked={value.zip} onCheckedChange={(zip) => patch({ zip })} />
              <Label htmlFor={zipId} className="text-[13px] font-normal">
                Als ZIP packen
              </Label>
            </div>
          )}
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-xl bg-muted/50 p-3">
        <div className="flex items-center gap-2.5">
          <Switch
            id={cleanupId}
            checked={Boolean(cleanup)}
            onCheckedChange={(checked) =>
              patch({ cleanup: checked ? { olderThanDays: 30, keepLast: 10 } : null })
            }
          />
          <Label htmlFor={cleanupId} className="text-[13px] font-normal">
            Ältere Dateien im Zielordner aufräumen
          </Label>
        </div>
        {cleanup && (
          <div className="grid grid-cols-2 gap-3 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none">
            <FormRow label="Älter als (Tage)">
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                placeholder="egal"
                value={cleanup.olderThanDays ?? ""}
                onChange={(event) =>
                  patch({
                    cleanup: { ...cleanup, olderThanDays: optionalNumber(event.target.value) },
                  })
                }
              />
            </FormRow>
            <FormRow label="Neueste behalten">
              <Input
                type="number"
                min={1}
                inputMode="numeric"
                placeholder="alle"
                value={cleanup.keepLast ?? ""}
                onChange={(event) =>
                  patch({ cleanup: { ...cleanup, keepLast: optionalNumber(event.target.value) } })
                }
              />
            </FormRow>
          </div>
        )}
      </div>
    </div>
  );
}
