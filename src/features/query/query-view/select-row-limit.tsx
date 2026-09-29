import { useId } from "react";
import { NewBadge } from "@/components/new-badge";
import { Input } from "@/components/ui/input";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useQueryWorkspace } from "@/lib/query-workspace";

export function SelectRowLimit({ disabled }: { disabled: boolean }) {
  const inputId = useId();
  const limit = useQueryWorkspace((state) => state.selectRowLimit);
  const update = useQueryWorkspace((state) => state.update);
  const { ref, isNew } = useNewFeatureVisibility<HTMLLabelElement>("query.select-row-limit");
  return (
    <label
      ref={ref}
      htmlFor={inputId}
      className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
      title="Zeilenlimit für SELECT. 0 = ohne Limit. Explizite SQL-Limits haben Vorrang."
    >
      Zeilenlimit
      <Input
        id={inputId}
        type="number"
        min={0}
        max={100000}
        step={1}
        value={limit || ""}
        placeholder="Ohne Limit"
        aria-label="SELECT-Zeilenlimit"
        className="h-7 w-28 text-xs"
        disabled={disabled}
        onChange={(event) => {
          const value = event.target.value === "" ? 0 : event.target.valueAsNumber;
          if (Number.isSafeInteger(value) && value >= 0 && value <= 100000)
            update({ selectRowLimit: value });
        }}
      />
      {isNew && <NewBadge />}
    </label>
  );
}
