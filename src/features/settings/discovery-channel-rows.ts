import type { DiscoveryChannel } from "@/lib/discovery/channels";

export interface DiscoveryChannelRow {
  channel: DiscoveryChannel;
  title: string;
}

export const DISCOVERY_CHANNEL_ROWS: DiscoveryChannelRow[] = [
  { channel: "promoter", title: "Passende Vorschläge" },
  { channel: "waitTips", title: "Tipps beim Warten" },
  { channel: "hotspots", title: "Hotspots für Neues" },
  { channel: "spotlight", title: "Hervorheben" },
  { channel: "welcomeBack", title: "Willkommen zurück" },
  { channel: "related", title: "Passt dazu" },
  { channel: "feedback", title: "Kurzes Feedback" },
  { channel: "teamTips", title: "Team-Tipps" },
  { channel: "videoTooltips", title: "Video-Tooltips" },
  { channel: "recap", title: "Jahresrückblick" },
  { channel: "achievements", title: "Erfolge" },
];
