import type { ComponentType } from "react";

export interface DiscoverySettingsSlot {
  id: string;
  load: () => Promise<{ default: ComponentType }>;
}

export const DISCOVERY_SETTINGS_SLOTS: DiscoverySettingsSlot[] = [
  { id: "feedback", load: () => import("@/features/discovery/feedback/feedback-settings") },
  {
    id: "modifier-overlay",
    load: () =>
      import("@/features/discovery/modifier-overlay/modifier-overlay-setting").then(
        ({ ModifierOverlaySetting }) => ({ default: ModifierOverlaySetting }),
      ),
  },
  {
    id: "labs",
    load: () =>
      import("@/features/discovery/labs/labs-settings-section").then(({ LabsSettingsSection }) => ({
        default: LabsSettingsSection,
      })),
  },
];
