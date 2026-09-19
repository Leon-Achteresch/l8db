import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect } from "react";
import { toast } from "sonner";
import { confirmExpertSql, fileLabel, fileStamp, readDashboardFile } from "@/lib/dashboard-file";
import { useDashboardsStore } from "@/lib/dashboards";

export function useDashboardFileReload(dashboardId: string, path: string | null) {
  const store = useDashboardsStore();
  const queryClient = useQueryClient();
  const reloadFile = useCallback(
    async (auto: boolean) => {
      if (!path) return;
      try {
        const stamp = await fileStamp(path);
        const current = useDashboardsStore.getState().dashboards.find((d) => d.id === dashboardId);
        if (!current || current.fileStamp === stamp) {
          if (!auto) toast.success("Dashboard ist aktuell");
          return;
        }
        if (!current.locked && auto) {
          toast.warning(`${fileLabel(path)} wurde geändert`, {
            action: { label: "Neu laden", onClick: () => void reloadFile(false) },
          });
          return;
        }
        const { dashboard: parsed } = await readDashboardFile(path);
        if (!confirmExpertSql(parsed)) return;
        store.update(dashboardId, {
          name: parsed.name,
          datasets: parsed.datasets,
          widgets: parsed.widgets,
          refreshSec: parsed.refreshSec,
          fileStamp: stamp,
        });
        void queryClient.invalidateQueries({ queryKey: ["dashboard-data"] });
        toast.success(`${fileLabel(path)} neu geladen`);
      } catch (error) {
        if (!auto)
          toast.error(error instanceof Error ? error.message : "Datei konnte nicht gelesen werden");
      }
    },
    [path, dashboardId, store, queryClient],
  );

  useEffect(() => {
    if (!path) return;
    void reloadFile(true);
    const onFocus = () => void reloadFile(true);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [path, reloadFile]);

  return reloadFile;
}
