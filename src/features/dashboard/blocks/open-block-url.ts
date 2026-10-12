import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import { isHttpsUrl } from "@/lib/dashboards";

export function openBlockUrl(href: string | undefined): void {
  if (!isHttpsUrl(href)) {
    toast.error("Nur https-Adressen können geöffnet werden.");
    return;
  }
  void openUrl(href).catch(() => toast.error("Adresse konnte nicht geöffnet werden."));
}
