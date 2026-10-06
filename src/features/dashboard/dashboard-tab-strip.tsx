import { ChartColumnIcon, LayoutDashboardIcon, XIcon } from "lucide-react";
import type { ChartTab } from "@/lib/dashboards";
import { cn } from "@/lib/utils";

export function DashboardTabStrip({
  dashboardName,
  tabs,
  active,
  onFocus,
  onClose,
}: {
  dashboardName: string;
  tabs: ChartTab[];
  active: string | null;
  onFocus: (id: string | null) => void;
  onClose: (tab: ChartTab) => void;
}) {
  if (tabs.length === 0) return null;
  const item = (id: string | null, label: string, Icon: typeof ChartColumnIcon, tab?: ChartTab) => {
    const selected = active === id;
    return (
      <div
        key={id ?? "dashboard"}
        role="presentation"
        className={cn(
          "group relative flex h-9 max-w-56 shrink-0 items-center gap-1.5 rounded-t-lg border border-b-0 px-3 text-xs transition-colors",
          selected
            ? "bg-background text-foreground after:absolute after:inset-x-0 after:-bottom-px after:h-px after:bg-background"
            : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        )}
      >
        <button
          type="button"
          role="tab"
          aria-selected={selected}
          onClick={() => onFocus(id)}
          onAuxClick={(event) => {
            if (event.button === 1 && tab) onClose(tab);
          }}
          className="flex min-w-0 items-center gap-1.5 outline-none focus-visible:underline"
        >
          <Icon className={cn("size-3.5 shrink-0", tab && "text-primary")} />
          <span className="truncate">{label}</span>
          {tab?.dirty && (
            <>
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-amber-500" />
              <span className="sr-only">Ungespeichert</span>
            </>
          )}
        </button>
        {tab && (
          <button
            type="button"
            aria-label={`${label} schließen`}
            onClick={() => onClose(tab)}
            className="-mr-1 grid size-5 place-items-center rounded opacity-60 hover:bg-muted hover:opacity-100 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <XIcon className="size-3" />
          </button>
        )}
      </div>
    );
  };
  return (
    <div
      role="tablist"
      aria-label="Geöffnete Charts"
      className="flex items-end gap-0.5 overflow-x-auto border-b px-4 sm:px-6"
    >
      {item(null, dashboardName, LayoutDashboardIcon)}
      {tabs.map((tab) =>
        item(tab.id, tab.widget.title || tab.dataset.name || "Neuer Chart", ChartColumnIcon, tab),
      )}
    </div>
  );
}
