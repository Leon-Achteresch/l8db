import { useCallback, useEffect, useState } from "react";
import { storageEntries } from "@/lib/app-storage";
import { useConnectionsStore } from "@/lib/connections";
import { connectionShares, storageAreas } from "@/lib/storage-usage";
import { useTableTabs } from "@/lib/table-tabs";

function measure(connectionIds: string[]) {
  const entries = storageEntries();
  const areas = storageAreas(entries);
  return {
    entries: new Map(entries),
    areas,
    shares: connectionShares(entries, connectionIds),
    total: areas.reduce((sum, area) => sum + area.bytes, 0),
  };
}

export function useStorageUsage() {
  const connections = useConnectionsStore((state) => state.connections);
  const [usage, setUsage] = useState(() => measure(connections.map((entry) => entry.id)));
  const [estimate, setEstimate] = useState<StorageEstimate>();
  const refresh = useCallback(() => {
    setUsage(measure(connections.map((entry) => entry.id)));
    void navigator.storage
      ?.estimate?.()
      .then(setEstimate)
      .catch(() => undefined);
  }, [connections]);

  useEffect(() => {
    refresh();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = useTableTabs.subscribe((state, previous) => {
      if (
        state.tabsByConnection === previous.tabsByConnection &&
        state.recentlyClosed === previous.recentlyClosed
      )
        return;
      clearTimeout(timer);
      timer = setTimeout(refresh, 400);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [refresh]);

  return { ...usage, estimate, refresh };
}
