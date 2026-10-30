import { CalendarIcon } from "lucide-react";
import { type ComponentProps, lazy, Suspense, startTransition, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const DateFilterPanel = lazy(() =>
  import("./date-filter-panel").then((module) => ({ default: module.DateFilterPanel })),
);

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
      <Suspense fallback={null}>
        <Popover
          open={open}
          onOpenChange={(next) => (next ? startTransition(() => setOpen(true)) : setOpen(false))}
        >
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
            <DateFilterPanel
              value={value}
              onValueChange={onValueChange}
              onPicked={() => setOpen(false)}
            />
          </PopoverContent>
        </Popover>
      </Suspense>
    </div>
  );
}
