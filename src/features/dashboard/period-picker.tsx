import { CalendarIcon } from "lucide-react";
import { useRef, useState } from "react";
import { NewBadge } from "@/components/new-badge";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  isPresetPeriod,
  PERIOD_LABEL,
  type Period,
  type PresetPeriod,
  periodLabel,
} from "@/lib/dashboards";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { cn } from "@/lib/utils";
import { PeriodRangeForm } from "./period-range-form";

const PER_WIDGET = "__widget";
const CUSTOM = "__custom";
const CUSTOM_ACTIVE = "__custom_active";

export function PeriodPicker({
  value,
  onChange,
  perWidget,
  hideLabel,
  align = "start",
  className,
}: {
  value: Period | null;
  onChange: (period: Period | null) => void;
  perWidget?: boolean;
  hideLabel?: boolean;
  align?: "start" | "end";
  className?: string;
}) {
  const [editing, setEditing] = useState(false);
  const opening = useRef(false);
  const feature = useNewFeatureVisibility<HTMLButtonElement>(
    perWidget ? "dashboard.period-range" : undefined,
  );
  const custom = value !== null && !isPresetPeriod(value);
  const selected = value === null ? PER_WIDGET : custom ? CUSTOM_ACTIVE : value;
  const label = value === null ? "Zeitraum je Chart" : periodLabel(value);
  return (
    <Popover open={editing} onOpenChange={setEditing}>
      <Select
        value={selected}
        onValueChange={(next) => {
          if (next === CUSTOM) {
            opening.current = true;
            setTimeout(() => setEditing(true));
          } else if (next === PER_WIDGET) onChange(null);
          else if (next !== CUSTOM_ACTIVE) onChange(next as Period);
        }}
      >
        <PopoverAnchor asChild>
          <SelectTrigger
            ref={feature.ref}
            size="sm"
            aria-label="Zeitraum"
            title={label}
            className={cn("h-7 gap-1.5 text-xs", className)}
          >
            <CalendarIcon className="size-3.5" />
            <span className={cn("truncate", hideLabel && "sr-only")}>
              <SelectValue>{label}</SelectValue>
            </span>
            {feature.isNew && <NewBadge />}
          </SelectTrigger>
        </PopoverAnchor>
        <SelectContent
          align={align}
          onCloseAutoFocus={(event) => {
            if (!opening.current) return;
            opening.current = false;
            event.preventDefault();
          }}
        >
          {perWidget && (
            <>
              <SelectItem value={PER_WIDGET}>Zeitraum je Chart</SelectItem>
              <SelectSeparator />
            </>
          )}
          {(Object.keys(PERIOD_LABEL) as PresetPeriod[]).map((key) => (
            <SelectItem key={key} value={key}>
              {PERIOD_LABEL[key]}
            </SelectItem>
          ))}
          <SelectSeparator />
          {custom && <SelectItem value={CUSTOM_ACTIVE}>{label}</SelectItem>}
          <SelectItem value={CUSTOM}>Eigener Zeitraum…</SelectItem>
        </SelectContent>
      </Select>
      <PopoverContent align={align} className="w-auto max-w-[min(20rem,calc(100vw-2rem))]">
        {editing && (
          <PeriodRangeForm
            value={value}
            onCancel={() => setEditing(false)}
            onApply={(period) => {
              onChange(period);
              setEditing(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
