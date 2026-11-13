import { useMemo } from "react";
import { StorageAreaRow } from "@/features/settings/storage-area-row";
import { StorageConnectionRow } from "@/features/settings/storage-connection-row";
import { usesIndexedDb } from "@/lib/app-storage";
import { useConnectionsStore } from "@/lib/connections";
import { useNewFeatureVisibility } from "@/lib/hooks/use-new-feature-visibility";
import { useStorageUsage } from "@/lib/hooks/use-storage-usage";
import { formatBytes } from "@/lib/storage-usage";
import { useTableTabs } from "@/lib/table-tabs";

export function SettingsStorageTab() {
  const { ref } = useNewFeatureVisibility<HTMLDivElement>("settings.storage.overview");
  const { areas, shares, entries, total, estimate } = useStorageUsage();
  const connections = useConnectionsStore((state) => state.connections);
  const tabsByConnection = useTableTabs((state) => state.tabsByConnection);
  const connectionIds = useMemo(() => connections.map((entry) => entry.id), [connections]);

  const rows = useMemo(() => {
    const known = new Set(connectionIds);
    const orphans = new Set(
      [...shares.keys(), ...Object.keys(tabsByConnection)].filter((id) => !known.has(id)),
    );
    return [
      ...connections.map((entry) => ({ id: entry.id, name: entry.name, kind: entry.kind })),
      ...[...orphans].map((id) => ({
        id,
        name: id === "__none__" ? "Ohne Verbindung" : `Gelöschte Verbindung · ${id.slice(0, 8)}`,
        kind: undefined,
      })),
    ]
      .filter((row) => known.has(row.id) || shares.has(row.id) || tabsByConnection[row.id]?.length)
      .sort((a, b) => (shares.get(b.id)?.bytes ?? 0) - (shares.get(a.id)?.bytes ?? 0));
  }, [connections, connectionIds, shares, tabsByConnection]);

  const maxConnectionBytes = Math.max(1, ...rows.map((row) => shares.get(row.id)?.bytes ?? 0));
  const maxAreaBytes = Math.max(1, ...areas.map((area) => area.bytes));
  const quota = estimate?.quota ?? 0;
  const used = total;

  return (
    <div ref={ref} className="space-y-6" data-setting-id="storage-overview">
      <h2 className="text-base font-semibold tracking-tight">Speicher</h2>

      <div className="rounded-xl bg-muted/40 p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-2xl font-semibold tabular-nums">{formatBytes(total)}</span>
          <span className="text-xs text-muted-foreground">
            {usesIndexedDb() ? "IndexedDB" : "localStorage"}
          </span>
          {quota ? (
            <span className="ml-auto text-xs tabular-nums text-muted-foreground">
              von {formatBytes(quota)}
            </span>
          ) : null}
        </div>
        {quota ? (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary"
              style={{ width: `${Math.min(100, Math.max(0.5, (used / quota) * 100))}%` }}
            />
          </div>
        ) : null}
      </div>

      <section aria-labelledby="storage-connections-heading">
        <h3 id="storage-connections-heading" className="px-2 text-sm font-medium">
          Verbindungen
        </h3>
        <ul className="mt-2 space-y-0.5">
          {rows.map((row) => (
            <StorageConnectionRow
              key={row.id}
              id={row.id}
              name={row.name}
              kind={row.kind}
              share={shares.get(row.id)}
              maxBytes={maxConnectionBytes}
              connectionIds={connectionIds}
            />
          ))}
        </ul>
      </section>

      <section aria-labelledby="storage-areas-heading">
        <h3 id="storage-areas-heading" className="px-2 text-sm font-medium">
          Datenbereiche
        </h3>
        <ul className="mt-2 space-y-0.5">
          {areas.map((area) => (
            <StorageAreaRow
              key={area.key}
              area={area}
              value={entries.get(area.key) ?? ""}
              maxBytes={maxAreaBytes}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}
