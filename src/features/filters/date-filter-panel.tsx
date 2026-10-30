import {
  format,
  isValid,
  parseISO,
  startOfMonth,
  startOfYear,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { de } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";

const PRESETS: { label: string; date: (today: Date) => Date }[] = [
  { label: "Heute", date: (today) => today },
  { label: "Gestern", date: (today) => subDays(today, 1) },
  { label: "Vor einer Woche", date: (today) => subWeeks(today, 1) },
  { label: "Vor einem Monat", date: (today) => subMonths(today, 1) },
  { label: "Monatsanfang", date: startOfMonth },
  { label: "Jahresanfang", date: startOfYear },
];

type DateFilterPanelProps = {
  value: string;
  onValueChange: (value: string) => void;
  onPicked: () => void;
};

export function DateFilterPanel({ value, onValueChange, onPicked }: DateFilterPanelProps) {
  const today = new Date();
  const day = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  const parsed = day ? parseISO(day) : undefined;
  const selected = parsed && isValid(parsed) ? parsed : undefined;
  const pick = (date: Date) => {
    onValueChange(format(date, "yyyy-MM-dd") + (day ? value.slice(10) : ""));
    onPicked();
  };

  return (
    <>
      <div className="flex flex-col gap-0.5 border-r p-2">
        {PRESETS.map((preset) => {
          const date = preset.date(today);
          return (
            <button
              key={preset.label}
              type="button"
              onClick={() => pick(date)}
              className="flex items-center justify-between gap-6 rounded-md px-2.5 py-1.5 text-left transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
            >
              {preset.label}
              <span className="text-xs tabular-nums text-muted-foreground">
                {format(date, "dd.MM.")}
              </span>
            </button>
          );
        })}
      </div>
      <Calendar
        mode="single"
        required
        locale={de}
        captionLayout="dropdown"
        endMonth={new Date(today.getFullYear() + 10, 11)}
        selected={selected}
        defaultMonth={selected}
        onSelect={pick}
      />
    </>
  );
}
