export const DISCOVERY_CHANNELS = [
  "promoter",
  "waitTips",
  "hotspots",
  "spotlight",
  "welcomeBack",
  "feedback",
  "related",
  "teamTips",
  "recap",
  "achievements",
  "videoTooltips",
] as const;

export type DiscoveryChannel = (typeof DISCOVERY_CHANNELS)[number];

export interface DiscoverySettings {
  enabled: boolean;
  channels: Record<DiscoveryChannel, boolean>;
  labs: Record<string, boolean>;
}

const MAX_LABS = 64;

export function defaultDiscoveryChannels(): Record<DiscoveryChannel, boolean> {
  return Object.fromEntries(
    DISCOVERY_CHANNELS.map((channel) => [channel, channel !== "achievements"]),
  ) as Record<DiscoveryChannel, boolean>;
}

export const DEFAULT_DISCOVERY_SETTINGS: DiscoverySettings = {
  enabled: true,
  channels: defaultDiscoveryChannels(),
  labs: {},
};

export function normalizeDiscoverySettings(value: unknown): DiscoverySettings {
  const saved = (value && typeof value === "object" ? value : {}) as Partial<
    Record<keyof DiscoverySettings, unknown>
  >;
  const channels = defaultDiscoveryChannels();
  const savedChannels =
    saved.channels && typeof saved.channels === "object"
      ? (saved.channels as Record<string, unknown>)
      : {};
  for (const channel of DISCOVERY_CHANNELS) {
    if (typeof savedChannels[channel] === "boolean")
      channels[channel] = savedChannels[channel] as boolean;
  }
  const labs: Record<string, boolean> = {};
  if (saved.labs && typeof saved.labs === "object") {
    for (const [id, enabled] of Object.entries(saved.labs as Record<string, unknown>)) {
      if (Object.keys(labs).length >= MAX_LABS) break;
      if (typeof enabled === "boolean" && /^[a-z0-9][a-z0-9._-]{0,63}$/i.test(id))
        labs[id] = enabled;
    }
  }
  return { enabled: saved.enabled !== false, channels, labs };
}
