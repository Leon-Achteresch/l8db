import { toast } from "sonner";
import {
  confirmExpertSql,
  fileLabel,
  pickDashboardFile,
  readDashboardFile,
} from "@/lib/dashboard-file";
import { useDashboardsStore } from "@/lib/dashboards";
export async function openDashboardFromFile(connectionId: string, database: string | null) {
  try {
    const path = await pickDashboardFile();
    if (!path) return;
    const { dashboard, stamp } = await readDashboardFile(path);
    if (!confirmExpertSql(dashboard)) return;
    useDashboardsStore
      .getState()
      .importDashboard(
        { ...dashboard, locked: true, filePath: path, fileStamp: stamp },
        connectionId,
        database,
      );
    toast.success(`Dashboard aus ${fileLabel(path)} geladen`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : "Datei konnte nicht geladen werden");
  }
}
