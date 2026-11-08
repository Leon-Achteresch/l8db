import type { ComponentType } from "react";

export interface DiscoveryHostEntry {
  id: string;
  load: () => Promise<{ default: ComponentType }>;
}

export const DISCOVERY_HOSTS: DiscoveryHostEntry[] = [];
