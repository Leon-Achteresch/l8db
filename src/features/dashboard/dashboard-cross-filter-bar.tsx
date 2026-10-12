import { FilterIcon, XIcon } from "lucide-react";
import { useCrossFilterStore, useCrossFilters } from "@/lib/dashboards";

export function DashboardCrossFilterBar({ dashboardId }: { dashboardId: string }) {
  const filters = useCrossFilters(dashboardId);
  if (!filters.length) return null;
  const store = useCrossFilterStore.getState();
  return (
    <div className="dashboard-selection flex shrink-0 flex-wrap items-center gap-1.5 border-b px-4 py-1.5 text-xs">
      <FilterIcon className="size-3.5 text-muted-foreground" />
      <span className="text-muted-foreground">Auswahl:</span>
      {filters.map((filter) => (
        <span
          key={`${filter.widgetId}-${filter.key}`}
          className="inline-flex max-w-72 items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--dash-accent)_14%,transparent)] py-0.5 pr-1 pl-2.5 font-medium text-foreground"
        >
          <span className="truncate">{filter.label}</span>
          <button
            type="button"
            aria-label={`Filter ${filter.label} entfernen`}
            className="rounded-full p-0.5 hover:bg-foreground/10"
            onClick={() => store.remove(dashboardId, filter.widgetId, filter.key)}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      {filters.length > 1 && (
        <button
          type="button"
          className="ml-1 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => store.clear(dashboardId)}
        >
          Alle aufheben
        </button>
      )}
    </div>
  );
}
