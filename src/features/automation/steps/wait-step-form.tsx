import { SegmentedControl } from "@/components/motion/segmented-control";
import { Input } from "@/components/ui/input";
import { FormRow } from "../form-row";
import { optionalNumber, type StepFormProps, useFieldError } from "../step-form-context";

const MODES = [
  { value: "duration", label: "Dauer" },
  { value: "until", label: "Bis Uhrzeit" },
] as const;

function human(seconds: number | null): string | undefined {
  if (!seconds || seconds < 60) return undefined;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return `= ${hours ? `${hours} Std. ` : ""}${minutes ? `${minutes} Min.` : ""}`.trim();
}

export function WaitStepForm({ action, onChange }: StepFormProps<"wait">) {
  const secondsError = useFieldError("seconds");
  const untilError = useFieldError("until");
  const mode = action.until !== null ? "until" : "duration";

  return (
    <div className="flex flex-col gap-4">
      <div className="max-w-64">
        <SegmentedControl
          label="Warten auf"
          value={mode}
          options={MODES}
          onChange={(next) =>
            onChange(
              next === "until"
                ? { ...action, until: "06:00", seconds: null }
                : { ...action, until: null, seconds: 60 },
            )
          }
        />
      </div>
      {mode === "duration" ? (
        <FormRow
          label="Sekunden"
          error={secondsError}
          hint={human(action.seconds) ?? "Höchstens 24 Stunden."}
          className="max-w-48"
        >
          <Input
            type="number"
            min={1}
            max={86400}
            inputMode="numeric"
            value={action.seconds ?? ""}
            onChange={(event) =>
              onChange({ ...action, seconds: optionalNumber(event.target.value) })
            }
          />
        </FormRow>
      ) : (
        <FormRow
          label="Uhrzeit"
          error={untilError}
          hint="Heute, oder morgen, falls schon vorbei."
          className="max-w-48"
        >
          <Input
            type="time"
            value={action.until ?? ""}
            onChange={(event) => onChange({ ...action, until: event.target.value })}
          />
        </FormRow>
      )}
    </div>
  );
}
