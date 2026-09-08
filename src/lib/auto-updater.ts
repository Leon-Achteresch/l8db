import { toast } from "sonner";
import { useSettingsStore } from "@/lib/settings";
import {
  checkForUpdates,
  getPendingUpdate,
  installUpdateAndRelaunch,
  presentUpdate,
} from "@/lib/updater";

const STARTUP_DELAY_MS = 3000;
const PERIODIC_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let started = false;

export function initAutoUpdater(): void {
  if (started || import.meta.env.DEV) return;
  started = true;
  window.setTimeout(() => {
    void runCheck();
  }, STARTUP_DELAY_MS);
  window.setInterval(() => {
    void runCheck();
  }, PERIODIC_CHECK_INTERVAL_MS);
}

async function runCheck(): Promise<void> {
  try {
    const { autoUpdateCheck, autoUpdateInstall, skippedUpdateVersion } =
      useSettingsStore.getState();
    if (!autoUpdateCheck) return;
    const previousVersion = getPendingUpdate()?.version;
    const update = await checkForUpdates();
    if (!update) return;
    if (update.version === skippedUpdateVersion) return;
    if (autoUpdateInstall) {
      await installSilently();
      return;
    }
    if (update.version !== previousVersion) presentUpdate(update);
  } catch {
    return;
  }
}

async function installSilently(): Promise<void> {
  const update = getPendingUpdate();
  if (!update) return;
  toast.info(`Update auf Version ${update.version} wird installiert …`, {
    description: "Die App startet danach automatisch neu.",
  });
  try {
    await installUpdateAndRelaunch(update);
  } catch {
    toast.error("Automatisches Update fehlgeschlagen", {
      description: "Bitte das Update-Fenster erneut öffnen oder manuell installieren.",
      action: {
        label: "Anzeigen",
        onClick: () => {
          const pending = getPendingUpdate();
          if (pending) presentUpdate(pending);
        },
      },
    });
  }
}
