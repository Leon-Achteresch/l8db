import { ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { ProviderLogo } from "@/components/provider-logo";
import { StorageConfirmButton } from "@/features/settings/storage-confirm-button";
import { commitStorageAndReload } from "@/lib/app-storage";
import type { DatabaseKind } from "@/lib/db";
import {
  CONNECTION_REMOVABLE_KEYS,
  type ConnectionShare,
  formatBytes,
  storageLabel,
  withoutConnection,
} from "@/lib/storage-usage";
import { tabLabel } from "@/lib/tab-navigation";
import { tabKey, useTableTabs } from "@/lib/table-tabs";
import { cn } from "@/lib/utils";

interface Props {
  id: string;
  name: string;
  kind?: DatabaseKind;
  share?: ConnectionShare;
  maxBytes: number;
  connectionIds: string[];
}

const tabBytes = (tab: object) => JSON.stringify(tab).length * 2;

export function StorageConnectionRow({ id, name, kind, share, maxBytes, connectionIds }: Props) {
  const [open, setOpen] = useState(false);
  const openTabs = useTableTabs((state) => state.tabsByConnection[id]);
  const recentlyClosed = useTableTabs((state) => state.recentlyClosed);
  const closed = useMemo(
    () => recentlyClosed.filter((tab) => tab.closedConnectionId === id),
    [recentlyClosed, id],
  );
  const tabs = openTabs ?? [];
  const bytes = share?.bytes ?? 0;
  const removable = [...(share?.areas.keys() ?? [])].filter((key) =>
    CONNECTION_REMOVABLE_KEYS.has(key),
  );

  const removeData = (keys: string[]) => {
    const changes: Record<string, string> = {};
    for (const key of keys) {
      const value = localStorage.getItem(key);
      const next = value === null ? null : withoutConnection(key, value, id, connectionIds);
      if (next !== null) changes[key] = next;
    }
    void commitStorageAndReload(changes);
  };

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/50"
      >
        <ProviderLogo kind={kind} className="size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-sm">{name}</span>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-foreground/35"
              style={{ width: `${bytes ? Math.max(1, (bytes / maxBytes) * 100) : 0}%` }}
            />
          </div>
        </div>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {tabs.length} Tabs
        </span>
        <span className="w-16 shrink-0 text-right text-xs tabular-nums">{formatBytes(bytes)}</span>
        <ChevronRight
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-90",
          )}
        />
      </button>
      {open ? (
        <div className="mt-1 mb-2 ml-9 space-y-4 rounded-lg bg-muted/40 p-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground">
                Offene Tabs · {tabs.length}
              </span>
              {tabs.length > 0 ? (
                <StorageConfirmButton
                  label="Alle schließen"
                  title={`Alle Tabs von ${name} schließen?`}
                  confirm="Schließen"
                  onConfirm={() => useTableTabs.getState().clearTabsForConnection(id)}
                />
              ) : null}
            </div>
            <ul className="mt-1">
              {tabs.map((tab) => (
                <li
                  key={tabKey(tab)}
                  className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/60"
                >
                  <span className="min-w-0 flex-1 truncate text-xs">{tabLabel(tab)}</span>
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {formatBytes(tabBytes(tab))}
                  </span>
                  <StorageConfirmButton
                    iconOnly
                    label={`${tabLabel(tab)} schließen`}
                    title={`${tabLabel(tab)} schließen?`}
                    confirm="Schließen"
                    onConfirm={() => useTableTabs.getState().discardTabs(id, [tabKey(tab)])}
                  />
                </li>
              ))}
            </ul>
          </div>
          {closed.length > 0 ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground tabular-nums">
                Geschlossene Tabs · {closed.length} ·{" "}
                {formatBytes(closed.reduce((sum, tab) => sum + tabBytes(tab), 0))}
              </span>
              <StorageConfirmButton
                label="Leeren"
                title="Geschlossene Tabs leeren?"
                confirm="Leeren"
                onConfirm={() => {
                  const { forgetClosedTab } = useTableTabs.getState();
                  for (const tab of closed) if (tab.recoveryId) forgetClosedTab(tab.recoveryId);
                }}
              />
            </div>
          ) : null}
          {share && share.areas.size > 0 ? (
            <div>
              <span className="text-xs font-medium text-muted-foreground">Daten</span>
              <ul className="mt-1">
                {[...share.areas]
                  .sort((a, b) => b[1] - a[1])
                  .map(([key, size]) => (
                    <li key={key} className="flex items-center gap-2 rounded-md px-1 py-0.5">
                      <span className="min-w-0 flex-1 truncate text-xs">{storageLabel(key)}</span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">
                        {formatBytes(size)}
                      </span>
                      {CONNECTION_REMOVABLE_KEYS.has(key) ? (
                        <StorageConfirmButton
                          iconOnly
                          label={`${storageLabel(key)} von ${name} löschen`}
                          title={`${storageLabel(key)} von ${name} löschen?`}
                          description="l8db lädt danach neu."
                          confirm="Löschen"
                          onConfirm={() => removeData([key])}
                        />
                      ) : (
                        <span className="size-[calc(1.5rem+var(--ui-density-step))]" />
                      )}
                    </li>
                  ))}
              </ul>
              {removable.length > 0 ? (
                <div className="mt-2 flex justify-end">
                  <StorageConfirmButton
                    label="Alle Daten löschen"
                    title={`Alle Daten von ${name} löschen?`}
                    description={`${removable.map(storageLabel).join(", ")}. l8db lädt danach neu.`}
                    confirm="Alles löschen"
                    onConfirm={() => removeData(removable)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
