import type { ComponentType } from "react";

export interface DiscoverySettingsSlot {
  id: string;
  load: () => Promise<{ default: ComponentType }>;
}

export const DISCOVERY_SETTINGS_SLOTS: DiscoverySettingsSlot[] = [];
