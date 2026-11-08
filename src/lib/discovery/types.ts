import type { Capabilities } from "@/lib/db";

export const FEATURE_AREAS = [
  "Verbindungen",
  "SQL-Editor",
  "Daten & Tabellen",
  "Schema & Struktur",
  "Analyse & Betrieb",
  "KI & MCP",
  "Automatisierung",
  "Dashboards",
  "Versionierung",
  "Arbeitsbereich",
  "Einstellungen & App",
  "Cloud & BaaS",
] as const;

export type FeatureArea = (typeof FEATURE_AREAS)[number];

export type FeatureCapability =
  | {
      [K in keyof Capabilities]: Capabilities[K] extends boolean ? K : never;
    }[keyof Capabilities]
  | "sql";

export interface GuideStep {
  anchor: string;
  title: string;
  body?: string;
  route?: string;
  safeClick?: boolean;
}

export interface FeatureEntry {
  id: string;
  title: string;
  summary: string;
  area: FeatureArea;
  keywords: readonly string[];
  route?: string;
  anchor?: string;
  hotkey?: string;
  videoId?: string;
  related?: readonly string[];
  since?: string;
  size?: "major" | "minor";
  capability?: FeatureCapability;
  hiddenInEasyMode?: boolean;
  steps?: readonly GuideStep[];
}

export interface FeatureSearchOptions {
  limit?: number;
  capabilities?: Capabilities | null;
  easyMode?: boolean;
  areas?: readonly FeatureArea[];
}
