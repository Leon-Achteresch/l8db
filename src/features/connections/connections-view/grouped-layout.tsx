import type { ReactNode } from "react";
import type { ServerGroup } from "@/lib/connection-groups";
import type { SavedConnection } from "@/lib/connections";
import { ConnectionGroupNav } from "../connection-group-nav";

export function ConnectionsGroupedLayout({
  groups,
  effectiveKey,
  filtered,
  favoriteServerKeys,
  activeGroupKey,
  setSelectedKey,
  displayGroups,
  renderGroup,
}: {
  groups: ServerGroup[];
  effectiveKey: string;
  filtered: SavedConnection[];
  favoriteServerKeys: string[];
  activeGroupKey: string | null;
  setSelectedKey: (value: string) => void;
  displayGroups: ServerGroup[];
  renderGroup: (group: ServerGroup) => ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-border/70 bg-card/20 shadow-xs">
      <aside className="hidden w-64 shrink-0 overflow-y-auto border-r border-border/70 bg-muted/15 p-3 md:block xl:w-72">
        <ConnectionGroupNav
          groups={groups}
          selectedKey={effectiveKey}
          allCount={filtered.length}
          favoriteKeys={favoriteServerKeys}
          activeGroupKey={activeGroupKey}
          onSelect={setSelectedKey}
        />
      </aside>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6">
        <div className="mb-4 md:hidden">
          <ConnectionGroupNav
            groups={groups}
            selectedKey={effectiveKey}
            allCount={filtered.length}
            favoriteKeys={favoriteServerKeys}
            activeGroupKey={activeGroupKey}
            onSelect={setSelectedKey}
          />
        </div>
        <div className="flex flex-col gap-8">{displayGroups.map(renderGroup)}</div>
      </div>
    </div>
  );
}
