import type { LucideIcon } from "lucide-react";
import { Input } from "@/components/ui/input";

interface McpLimitFieldProps {
  label: string;
  description: string;
  value: number;
  unit?: string;
  min: number;
  max: number;
  icon: LucideIcon;
  onChange: (value: number) => void;
}

export function McpLimitField({
  label,
  description,
  value,
  unit,
  min,
  max,
  icon: Icon,
  onChange,
}: McpLimitFieldProps) {
  const id = `mcp-limit-${label.replace(/\W+/g, "-").toLowerCase()}`;

  return (
    <div className="flex flex-col justify-between gap-3 rounded-2xl border border-border/70 bg-card/60 p-4 shadow-2xs transition-colors hover:border-border">
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="size-3.5" />
          </div>
          <span className="text-xs font-semibold text-foreground">{label}</span>
        </div>
        <p className="text-[11px] text-muted-foreground leading-relaxed">{description}</p>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <Input
          id={id}
          type="number"
          min={min}
          max={max}
          defaultValue={value}
          className="h-8 font-mono text-xs bg-background"
          onBlur={(e) => {
            const next = Number(e.target.value);
            if (Number.isFinite(next)) {
              onChange(Math.min(max, Math.max(min, Math.round(next))));
            }
          }}
        />
        {unit ? (
          <span className="shrink-0 text-xs font-mono text-muted-foreground">{unit}</span>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-[10px] text-muted-foreground/70 font-mono">
        <span>Min: {min}</span>
        <span>Max: {max}</span>
      </div>
    </div>
  );
}
