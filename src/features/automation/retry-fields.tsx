import { useId } from "react";
import { SegmentedControl } from "@/components/motion/segmented-control";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_RETRY } from "@/lib/automation/defaults";
import type { Backoff, RetryPolicy } from "@/lib/db/automation";
import { FormRow } from "./form-row";
import { optionalNumber } from "./step-form-context";

interface Props {
  value: RetryPolicy | null;
  onChange: (value: RetryPolicy | null) => void;
  offLabel: string;
}

const BACKOFF: { value: Backoff; label: string }[] = [
  { value: "fixed", label: "Gleich lang" },
  { value: "exponential", label: "Verdoppeln" },
];

export function describeRetry(retry: RetryPolicy): string {
  if (retry.attempts <= 0) return "Keine Wiederholung.";
  const pauses = Array.from({ length: Math.min(retry.attempts, 3) }, (_, index) => {
    const raw =
      retry.backoff === "exponential" ? retry.delaySeconds * 2 ** index : retry.delaySeconds;
    return Math.min(raw, retry.maxDelaySeconds ?? 3600);
  });
  const more = retry.attempts > 3 ? " …" : "";
  const times =
    retry.attempts === 1 ? "1 weiterer Versuch" : `Bis zu ${retry.attempts} weitere Versuche`;
  return `${times}, Pausen ${pauses.map((pause) => `${pause} s`).join(", ")}${more}.`;
}

export function RetryFields({ value, onChange, offLabel }: Props) {
  const id = useId();
  const patch = (next: Partial<RetryPolicy>) => value && onChange({ ...value, ...next });

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2.5">
        <Switch
          id={id}
          checked={Boolean(value)}
          onCheckedChange={(checked) => onChange(checked ? { ...DEFAULT_RETRY } : null)}
        />
        <Label htmlFor={id} className="text-[13px] font-normal">
          {value ? describeRetry(value) : offLabel}
        </Label>
      </div>
      {value && (
        <div className="grid grid-cols-2 gap-3 animate-in fade-in-0 slide-in-from-top-1 duration-200 motion-reduce:animate-none @lg/step:grid-cols-3">
          <FormRow label="Versuche">
            <Input
              type="number"
              min={0}
              max={20}
              inputMode="numeric"
              value={value.attempts}
              onChange={(event) => patch({ attempts: Number(event.target.value) || 0 })}
            />
          </FormRow>
          <FormRow label="Pause (s)">
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              value={value.delaySeconds}
              onChange={(event) => patch({ delaySeconds: Number(event.target.value) || 0 })}
            />
          </FormRow>
          <FormRow label="Max. Pause (s)">
            <Input
              type="number"
              min={0}
              inputMode="numeric"
              placeholder="3600"
              value={value.maxDelaySeconds ?? ""}
              onChange={(event) => patch({ maxDelaySeconds: optionalNumber(event.target.value) })}
            />
          </FormRow>
          <FormRow label="Pausen" bind={false} className="col-span-full">
            <SegmentedControl
              label="Pausen zwischen Versuchen"
              value={value.backoff}
              options={BACKOFF}
              onChange={(backoff) => patch({ backoff })}
            />
          </FormRow>
        </div>
      )}
    </div>
  );
}
