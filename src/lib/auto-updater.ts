import { toast } from "sonner";
import { useSettingsStore } from "@/lib/settings";
import {
  checkForUpdates,
  getPendingUpdate,
  installUpdateAndRelaunch,
  presentUpdate,
} from "@/lib/updater";

const STARTUP_DELAY_MS = 3000;

let started = false;

export function initAutoUpdater(): void {
  if (started || import.meta.env.DEV) return;
  started = true;
  window.setTimeout(() => {
    void runStartupCheck();
  }, STARTUP_DELAY_MS);
}

async function runStartupCheck(): Promise<void> {
  try {
    const { autoUpdateCheck, autoUpdateInstall } = useSettingsStore.getState();
    if (!autoUpdateCheck) return;
    const update = await checkForUpdates();
    if (!update) return;
    if (autoUpdateInstall) {
      await installSilently();
      return;
    }
    presentUpdate(update);
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
