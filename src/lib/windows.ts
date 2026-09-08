import { LogicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { toast } from "sonner";
import type { SavedConnection } from "@/lib/connections";

export async function openConnectionWindow(connection: SavedConnection): Promise<void> {
  const label = `conn-${connection.id}`.replace(/[^a-zA-Z0-9\-_]/g, "-");
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }
  const created = new WebviewWindow(label, {
    url: `/?connection=${encodeURIComponent(connection.id)}`,
    title: connection.name,
    width: 1280,
    height: 820,
    minWidth: 760,
    minHeight: 560,
    titleBarStyle: "overlay",
    hiddenTitle: true,
    trafficLightPosition: new LogicalPosition(12, 25),
  });
  created.once("tauri://error", () => {
    toast.error("Fenster konnte nicht geöffnet werden");
  });
}
