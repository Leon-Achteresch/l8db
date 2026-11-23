import { format, parseISO } from "date-fns";
import { useId, useState } from "react";
import type { DateRange } from "react-day-picker";
import { de } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { type CustomPeriod, customPeriod, type Period, parseCustomPeriod } from "@/lib/dashboards";

const iso = (date: Date | undefined) => (date ? format(date, "yyyy-MM-dd") : "");
const day = (text: string) => (/^\d{4}-\d{2}-\d{2}$/.test(text) ? parseISO(text) : undefined);

export function PeriodRangeForm({
  value,
  onApply,
  onCancel,
}: {
  value: Period | null;
  onApply: (period: CustomPeriod) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const current = value ? parseCustomPeriod(value) : null;
  const [start, setStart] = useState(current?.start ?? "");
  const [end, setEnd] = useState(current?.end ?? "");
  const [month, setMonth] = useState(() => day(current?.start ?? "") ?? new Date());
  const follow = (text: string) => {
    const date = day(text);
    if (date) setMonth(date);
  };
  const period = customPeriod(start, end || start);
  const range: DateRange | undefined = day(start) ? { from: day(start), to: day(end) } : undefined;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (period) onApply(period);
      }}
    >
      <div className="grid grid-cols-2 gap-2">
        <label
          htmlFor={`${id}-from`}
          className="space-y-1 text-[11px] font-medium text-muted-foreground"
        >
          <span>Von</span>
          <Input
            id={`${id}-from`}
            type="date"
            value={start}
            onChange={(event) => {
              setStart(event.target.value);
              follow(event.target.value);
            }}
            className="h-8 text-xs"
          />
        </label>
        <label
          htmlFor={`${id}-to`}
          className="space-y-1 text-[11px] font-medium text-muted-foreground"
        >
          <span>Bis</span>
          <Input
            id={`${id}-to`}
            type="date"
            value={end}
            onChange={(event) => {
              setEnd(event.target.value);
              if (!day(start)) follow(event.target.value);
            }}
            className="h-8 text-xs"
          />
        </label>
      </div>
      <Calendar
        mode="range"
        locale={de}
        captionLayout="dropdown"
        selected={range}
        month={month}
        onMonthChange={setMonth}
        onSelect={(next) => {
          setStart(iso(next?.from));
          setEnd(iso(next?.to));
        }}
        className="mx-auto p-0"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Abbrechen
        </Button>
        <Button type="submit" size="sm" disabled={!period}>
          Übernehmen
        </Button>
      </div>
    </form>
  );
}
