import { useNavigate } from "@tanstack/react-router";
import { PlusIcon } from "lucide-react";
import { tabVisual } from "@/features/shell/table-tabs-sortable-tab";
import { useConnectionsStore } from "@/lib/connections";
import { recentTabKeys } from "@/lib/recent-tabs";
import { standaloneTabs, usePaneTabs, useSplitView } from "@/lib/split-view";
import { navigateToTab, tabLabel } from "@/lib/tab-navigation";
import { remoteTab, type Tab, tabKey, useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

import { PaneNumber } from "./pane-number";

const LIMIT = 8;

export function PaneSnapAssist({ index, override }: { index: number; override: string | null }) {
  const navigate = useNavigate();
  const paneTabs = useSplitView((state) => state.paneTabs);
  const tabs = useTableTabs((state) => state.tabs);
  const connections = useConnectionsStore((state) => state.connections);
  const visible = usePaneTabs();
  const recent = recentTabKeys();
  const byKey = new Map(tabs.map((tab) => [tabKey(tab), tab]));
  const size = (pane: number | null) => (pane === null ? 0 : paneTabs[pane].length === 1 ? 2 : 1);
  const candidates = [
    ...standaloneTabs(tabs, paneTabs).map((tab) => ({
      key: tabKey(tab),
      tab,
      pane: null as number | null,
    })),
    ...paneTabs.flatMap((keys, pane) =>
      pane === index
        ? []
        : keys.flatMap((key) => {
            const tab = byKey.get(key) ?? remoteTab(key);
            return tab ? [{ key, tab, pane }] : [];
          }),
    ),
  ]
    .sort((a, b) => size(a.pane) - size(b.pane) || rank(recent, a.key) - rank(recent, b.key))
    .slice(0, LIMIT);

  const take = (key: string, tab: Tab) => {
    useSplitView.getState().moveTab(key, index);
    if (!remoteTab(key)) navigateToTab(navigate, tab);
  };
  const newQuery = () => {
    useSplitView.getState().focusPane(index);
    const id = useTableTabs.getState().openQueryTab();
    void navigate({ to: "/query/$id", params: { id } });
  };

  return (
    <div className="flex h-full min-h-0 flex-1 items-center justify-center overflow-auto p-6">
      <div className="flex w-full max-w-sm flex-col gap-3">
        <div className="text-center">
          <p className="text-sm font-medium text-foreground">Was soll hier angezeigt werden?</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {override
              ? `Objekt von ${override} in der Sidebar wählen oder einen Tab hierher ziehen.`
              : "Tab auswählen, hierher ziehen oder in der Sidebar öffnen."}
          </p>
        </div>
        {candidates.length > 0 && (
          <ul aria-label="Geöffnete Tabs" className="flex flex-col gap-1">
            {candidates.map(({ key, tab, pane }) => {
              const { Icon, iconColor } = tabVisual(tab);
              const remote = remoteTab(key)?.connectionId;
              const color = remote
                ? (connections.find((entry) => entry.id === remote)?.color ?? "#64748b")
                : null;
              return (
                <li key={key}>
                  <button
                    type="button"
                    onClick={() => take(key, tab)}
                    className={cn(
                      "flex h-9 w-full items-center gap-2 rounded-lg border border-border/70 bg-card px-2.5 text-left text-xs transition-colors hover:border-primary/40 hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      pane !== null &&
                        visible[pane] &&
                        tabKey(visible[pane]) === key &&
                        "font-medium",
                    )}
                  >
                    <Icon className={cn("size-3.5 shrink-0", iconColor)} />
                    <span className="min-w-0 flex-1 truncate">{tabLabel(tab)}</span>
                    {color && (
                      <span
                        aria-hidden="true"
                        className="size-1.5 shrink-0 rounded-full"
                        style={{ backgroundColor: color }}
                      />
                    )}
                    {pane !== null && <PaneNumber index={pane} />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          onClick={newQuery}
          className="flex h-9 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <PlusIcon className="size-3.5" />
          Neue Abfrage
        </button>
      </div>
    </div>
  );
}

function rank(recent: readonly string[], key: string): number {
  const at = recent.indexOf(key);
  return at === -1 ? recent.length : at;
}
