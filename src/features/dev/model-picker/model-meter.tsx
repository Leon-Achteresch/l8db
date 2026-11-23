import { cn } from "@/lib/utils";

export function ModelMeter({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex items-center gap-0.5" role="img" aria-label={`${label}: ${value} von 3`}>
      {[1, 2, 3].map((step) => (
        <span
          key={step}
          className={cn(
            "h-2.5 w-1 rounded-full bg-muted-foreground/20",
            step <= value && "bg-foreground/70",
          )}
        />
      ))}
    </span>
  );
}
