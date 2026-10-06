import { PlusIcon } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CHART_FIELD_MIME } from "./chart-visual-builder-model";
import { useFieldDragActive } from "./use-field-drag-active";

export function ChartFieldZone({
  title,
  hint,
  selectedLabel,
  onAssign,
  onDrop,
  children,
}: {
  title: string;
  hint: string;
  selectedLabel?: string;
  onAssign: () => void;
  onDrop: (ref: string) => void;
  children: ReactNode;
}) {
  const [over, setOver] = useState(false);
  const dragging = useFieldDragActive(CHART_FIELD_MIME);
  return (
    <section
      aria-label={title}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(CHART_FIELD_MIME)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const ref = event.dataTransfer.getData(CHART_FIELD_MIME);
        if (ref) onDrop(ref);
      }}
      className={cn(
        "space-y-3 rounded-xl border bg-card p-3 transition-[border-color,background-color,box-shadow] duration-200",
        dragging && !over && "border-dashed border-primary/50 bg-primary/[0.03]",
        selectedLabel && !dragging && "border-primary/30",
        over && "border-primary bg-primary/5 ring-2 ring-primary/15",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold">{title}</h3>
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{hint}</p>
        </div>
        <Button
          size="xs"
          variant="ghost"
          disabled={!selectedLabel}
          aria-label={`${selectedLabel ?? "Ausgewähltes Feld"} zu ${title} zuweisen`}
          title={selectedLabel ? `${selectedLabel} zuweisen` : "Wähle zuerst links ein Datenfeld"}
          onClick={onAssign}
          className={cn(
            "shrink-0",
            selectedLabel && "bg-primary/10 text-primary hover:bg-primary/15",
          )}
        >
          <PlusIcon /> Zuweisen
        </Button>
      </div>
      {children}
    </section>
  );
}
