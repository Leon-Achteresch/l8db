export function SliderValue({ value, unit }: { value: string; unit?: string }) {
  return (
    <span className="w-14 shrink-0 text-right font-mono text-xs text-muted-foreground tabular-nums">
      {value}
      {unit}
    </span>
  );
}
