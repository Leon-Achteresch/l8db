import { lockedSetting } from "@/lib/organization-state";
import { type SettingsState, useSettingsStore } from "@/lib/settings";
import { issueDraftUrl } from "./feedback";

export interface LabMirror {
  settingKey: keyof SettingsState;
  read: (state: SettingsState) => boolean;
  write: (enabled: boolean) => void;
}

export interface LabEntry {
  id: string;
  title: string;
  summary: string;
  featureId?: string;
  mirror?: LabMirror;
}

export const LABS: readonly LabEntry[] = [
  {
    id: "canary-updates",
    title: "Canary-Updates",
    summary: "Neue Versionen früher, ohne Gewähr.",
    featureId: "settings.update-channel",
    mirror: {
      settingKey: "updateChannel",
      read: (state) => state.updateChannel === "canary",
      write: (enabled) => {
        useSettingsStore.getState().setUpdateChannel(enabled ? "canary" : "stable");
        void import("@/lib/updater").then(({ setPendingUpdate }) => setPendingUpdate(null));
      },
    },
  },
  {
    id: "achievements",
    title: "Erfolge",
    summary: "Kleine Meilensteine aus deiner Nutzung.",
    mirror: {
      settingKey: "discovery",
      read: (state) => state.discovery.enabled && state.discovery.channels.achievements,
      write: (enabled) => {
        const { discovery, setDiscovery } = useSettingsStore.getState();
        setDiscovery({
          enabled: enabled || discovery.enabled,
          channels: { ...discovery.channels, achievements: enabled },
        });
      },
    },
  },
];

const byId = new Map(LABS.map((lab) => [lab.id, lab]));

export function labById(id: string): LabEntry | undefined {
  return byId.get(id);
}

export function labEnabled(
  id: string,
  state: SettingsState = useSettingsStore.getState(),
): boolean {
  const lab = byId.get(id);
  if (!lab) return false;
  return lab.mirror ? lab.mirror.read(state) : state.discovery.labs[id] === true;
}

export function labLocked(id: string): boolean {
  const key = byId.get(id)?.mirror?.settingKey;
  return key !== undefined && lockedSetting(key);
}

export function setLab(id: string, enabled: boolean): void {
  const lab = byId.get(id);
  if (!lab || labLocked(id)) return;
  if (lab.mirror) {
    lab.mirror.write(enabled);
    return;
  }
  const { discovery, setDiscovery } = useSettingsStore.getState();
  setDiscovery({ labs: { ...discovery.labs, [id]: enabled } });
}

export function useLab(id: string): boolean {
  return useSettingsStore((state) => labEnabled(id, state));
}

export function labFeedbackUrl(lab: LabEntry, version: string | null): string {
  return issueDraftUrl(
    `Labs: ${lab.title}`,
    ["### Feedback zu Labs", "", "", "### Umgebung", `l8db ${version ?? "unbekannt"}`].join("\n"),
    "feedback",
  );
}
