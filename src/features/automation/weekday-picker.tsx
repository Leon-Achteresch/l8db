import { WEEKDAYS } from "@/lib/automation/schedule-text";
import { cn } from "@/lib/utils";

interface Props {
  value: number[];
  onChange: (value: number[]) => void;
  invalid?: boolean;
}

const WORKDAYS = [1, 2, 3, 4, 5];
const ALL = [1, 2, 3, 4, 5, 6, 7];

function same(a: number[], b: number[]): boolean {
  return a.length === b.length && b.every((day) => a.includes(day));
}

export function WeekdayPicker({ value, onChange, invalid }: Props) {
  const toggle = (day: number) =>
    onChange(
      value.includes(day)
        ? value.filter((entry) => entry !== day)
        : [...value, day].sort((a, b) => a - b),
    );
  const preset = (days: number[], label: string) => (
    <button
      type="button"
      aria-pressed={same(value, days)}
      onClick={() => onChange(days)}
      className="h-8 rounded-lg px-2.5 text-xs font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 aria-pressed:bg-muted aria-pressed:text-foreground"
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <fieldset
        aria-label="Wochentage"
        aria-invalid={invalid || undefined}
        className={cn(
          "m-0 inline-flex min-w-0 rounded-xl border-0 bg-muted p-1",
          invalid && "ring-1 ring-destructive",
        )}
      >
        {WEEKDAYS.map((day) => (
          <button
            key={day.value}
            type="button"
            aria-pressed={value.includes(day.value)}
            aria-label={day.long}
            onClick={() => toggle(day.value)}
            className={cn(
              "h-7 w-9 rounded-lg text-xs font-medium text-muted-foreground transition-[background-color,color,box-shadow,scale] outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 active:scale-[0.96]",
              "aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm",
            )}
          >
            {day.short}
          </button>
        ))}
      </fieldset>
      <div className="flex items-center gap-0.5">
        {preset(WORKDAYS, "Werktags")}
        {preset([6, 7], "Wochenende")}
        {preset(ALL, "Jeden Tag")}
      </div>
    </div>
  );
}
