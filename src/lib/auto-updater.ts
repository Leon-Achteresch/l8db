import type { Update } from "@tauri-apps/plugin-updater";
import { toast } from "sonner";
import { recordDiagnosticError } from "@/lib/diagnostics";
import { useSettingsStore } from "@/lib/settings";
import {
  collectUpdateBlockers,
  describeUpdateBlockers,
  updateCanRelaunch,
} from "@/lib/update-blockers";
import {
  checkForUpdates,
  getPendingUpdate,
  installUpdateAndRelaunch,
  presentUpdate,
  shouldRunCheck,
} from "@/lib/updater";

const STARTUP_DELAY_MS = 3000;
const TICK_MS = 60_000;

let started = false;
let lastCheck = 0;
let running = false;

export function initAutoUpdater(): void {
  if (started || import.meta.env.DEV) return;
  started = true;
  window.setTimeout(() => {
    void maybeCheck(true);
  }, STARTUP_DELAY_MS);
  window.setInterval(() => {
    void maybeCheck();
  }, TICK_MS);
  window.addEventListener("focus", () => {
    void maybeCheck();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void maybeCheck();
  });
}

async function maybeCheck(force = false): Promise<void> {
  if (running || !shouldRunCheck(Date.now(), lastCheck, force)) return;
  running = true;
  lastCheck = Date.now();
  try {
    await runCheck();
  } finally {
    running = false;
  }
}

export async function runCheck(): Promise<void> {
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
  } catch (error) {
    recordDiagnosticError("updater", String(error));
  }
}

function postpone(update: Update, reason: string): void {
  toast.info(`Update auf Version ${update.version} wartet`, {
    description: `Automatische Installation verschoben: ${reason}.`,
  });
  presentUpdate(update);
}

async function installSilently(): Promise<void> {
  const update = getPendingUpdate();
  if (!update) return;
  const blocked = describeUpdateBlockers(await collectUpdateBlockers());
  if (blocked) {
    postpone(update, blocked);
    return;
  }
  toast.info(`Update auf Version ${update.version} wird installiert …`, {
    description: "Die App startet danach automatisch neu.",
  });
  try {
    if (await installUpdateAndRelaunch(update, undefined, updateCanRelaunch)) return;
    postpone(
      update,
      describeUpdateBlockers(await collectUpdateBlockers()) ?? "offene Arbeit in der App",
    );
  } catch (error) {
    recordDiagnosticError("updater", String(error));
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
