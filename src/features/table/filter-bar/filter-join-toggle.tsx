import type { Combinator } from "@/features/table/table-filter-panel/filter-types";

export function FilterJoinToggle({
  combinator,
  enabled,
  onToggle,
}: {
  combinator: Combinator;
  enabled: boolean;
  onToggle: () => void;
}) {
  const label = combinator === "OR" ? "oder" : "und";
  if (!enabled)
    return (
      <span className="shrink-0 px-0.5 text-[10px] font-medium uppercase text-muted-foreground">
        und
      </span>
    );
  return (
    <button
      type="button"
      onClick={onToggle}
      title="Zwischen „und“ und „oder“ wechseln"
      aria-label={`Verknüpfung „${label}“, klicken zum Wechseln`}
      className="shrink-0 rounded px-1 py-0.5 text-[10px] font-medium uppercase text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground"
    >
      {label}
    </button>
  );
}
