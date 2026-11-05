import { cn } from "@/lib/utils";

export function AiPanelTabs({
  tab,
  count,
  onTab,
}: {
  tab: "chat" | "results";
  count: number;
  onTab: (tab: "chat" | "results") => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Ansicht"
      className="mx-3 mb-1 flex shrink-0 gap-1 rounded-xl bg-muted/70 p-1"
    >
      {(
        [
          ["chat", "Gespräch"],
          ["results", "Ergebnisse"],
        ] as const
      ).map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={tab === id}
          onClick={() => onTab(id)}
          className={cn(
            "flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg text-[12px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
            tab === id && "bg-background font-medium text-foreground shadow-xs",
          )}
        >
          {label}
          {id === "results" && (
            <span className="text-[11px] font-semibold tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
