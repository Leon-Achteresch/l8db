import { loadOrganizationPolicy } from "@/lib/db/organization";
import { useOrganizationStore } from "@/lib/organization-state";
import { useSettingsStore } from "@/lib/settings";

let running: Promise<void> | null = null;

export function initOrganization(): Promise<void> {
  if (running) return running;
  running = loadOrganizationPolicy()
    .then((policy) => {
      if (!policy || typeof policy.managed !== "boolean")
        throw new Error("IT-Richtlinie konnte nicht geladen werden.");
      useOrganizationStore.setState({ policy, error: null });
      useSettingsStore.setState({});
    })
    .catch((error) => {
      useOrganizationStore.setState({
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    })
    .finally(() => {
      running = null;
    });
  return running;
}
