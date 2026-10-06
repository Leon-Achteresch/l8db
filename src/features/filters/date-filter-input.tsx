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
import { CalendarIcon } from "lucide-react";
import { type ComponentProps, useState } from "react";
import { de } from "react-day-picker/locale";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const PRESETS: { label: string; date: (today: Date) => Date }[] = [
  { label: "Heute", date: (today) => today },
  { label: "Gestern", date: (today) => subDays(today, 1) },
  { label: "Vor einer Woche", date: (today) => subWeeks(today, 1) },
  { label: "Vor einem Monat", date: (today) => subMonths(today, 1) },
  { label: "Monatsanfang", date: startOfMonth },
  { label: "Jahresanfang", date: startOfYear },
];

type DateFilterInputProps = Omit<ComponentProps<"input">, "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
};

export function DateFilterInput({
  value,
  onValueChange,
  className,
  ...props
}: DateFilterInputProps) {
  const [open, setOpen] = useState(false);
  const today = new Date();
  const day = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  const parsed = day ? parseISO(day) : undefined;
  const selected = parsed && isValid(parsed) ? parsed : undefined;
  const pick = (date: Date) => {
    onValueChange(format(date, "yyyy-MM-dd") + (day ? value.slice(10) : ""));
    setOpen(false);
  };

  return (
    <div
      className={cn(
        "flex h-[calc(2.25rem+var(--ui-density-step))] w-full min-w-0 items-center rounded-lg border border-input bg-background/80 text-sm shadow-[inset_0_1px_0_oklch(1_0_0/0.35)] transition-[box-shadow,border-color] duration-200 focus-within:border-primary focus-within:ring-3 focus-within:ring-ring/40 dark:bg-input/30",
        className,
      )}
    >
      <input
        {...props}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className="h-full min-w-0 flex-1 bg-transparent pl-3 tabular-nums outline-none placeholder:text-muted-foreground disabled:opacity-50"
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Datum wählen"
            title="Datum wählen"
            disabled={props.disabled}
            className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 data-[state=open]:bg-muted data-[state=open]:text-foreground"
          >
            <CalendarIcon className="size-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-auto flex-row gap-0 p-0">
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
        </PopoverContent>
      </Popover>
    </div>
  );
}
