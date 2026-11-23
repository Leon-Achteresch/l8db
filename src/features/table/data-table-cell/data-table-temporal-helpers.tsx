import { NewBadge } from "@/components/new-badge";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { type TemporalKind, temporalHelpers } from "@/lib/temporal-helpers";

export function DataTableTemporalHelpers({
  kind,
  disabled,
  onPick,
}: {
  kind: TemporalKind;
  disabled: boolean;
  onPick: (value: string) => void;
}) {
  const feature = useNewFeatureVisibility<HTMLDivElement>("table.rows.date-helpers");
  return (
    <div
      ref={feature.ref}
      className="flex items-center gap-1 overflow-x-auto whitespace-nowrap px-2 pt-1"
    >
      {temporalHelpers(kind).map((helper) => (
        <button
          key={helper.id}
          type="button"
          disabled={disabled}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(helper.value(new Date()))}
          className="shrink-0 cursor-pointer rounded bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:bg-muted/80 disabled:opacity-60"
        >
          {helper.label}
        </button>
      ))}
      {feature.isNew && <NewBadge className="shrink-0" />}
    </div>
  );
}
