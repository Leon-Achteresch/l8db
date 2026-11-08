import { useNavigate } from "@tanstack/react-router";
import { DiscoverTabContent } from "@/features/discovery/discover-tab-content";
import { DISCOVER_TABS, visibleDiscoverTabs } from "@/features/discovery/discover-tabs";
import { useRouterSelect } from "@/lib/hooks/use-router-select";
import { useTeamStore } from "@/lib/team/store";
import { cn } from "@/lib/utils";

export function DiscoverView() {
  const navigate = useNavigate();
  const requested = useRouterSelect(
    (state) => (state.location.search as { tab?: string }).tab ?? DISCOVER_TABS[0]?.id,
  );
  const teamExists = useTeamStore((state) => state.exists);
  const tabs = visibleDiscoverTabs({ teamExists });
  const active = tabs.find((tab) => tab.id === requested) ?? tabs[0];

  return (
    <main className="workspace-canvas h-full w-full min-w-0 overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 py-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Entdecken</h1>
          {tabs.length > 1 && (
            <div role="tablist" aria-label="Entdecken" className="flex flex-wrap gap-1">
              {tabs.map((tab) => {
                const selected = tab.id === active?.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    data-feature={`discover.${tab.id}`}
                    onClick={() => void navigate({ to: "/discover", search: { tab: tab.id } })}
                    className={cn(
                      "inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground active:scale-[0.98]",
                      selected && "bg-muted/60 font-medium text-foreground",
                    )}
                  >
                    <tab.icon className="size-4" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          )}
        </header>
        {active && <DiscoverTabContent tab={active} />}
      </div>
    </main>
  );
}
