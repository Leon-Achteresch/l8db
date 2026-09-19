import type { DatabaseKind } from "@/lib/db";

export const DIAGNOSTICS_FORMAT = "l8db-diagnostics";

export const DIAGNOSTICS_VERSION = 1;

export type DiagnosticsSectionId =
  | "app"
  | "system"
  | "drivers"
  | "providers"
  | "connections"
  | "settings"
  | "errors";

export const DIAGNOSTICS_SECTIONS: {
  id: DiagnosticsSectionId;
  label: string;
  description: string;
}[] = [
  { id: "app", label: "App", description: "Name und Version" },
  { id: "system", label: "System", description: "Plattform und Sprache" },
  { id: "drivers", label: "Treiber", description: "Verfügbarkeit je Datenbankfamilie" },
  { id: "providers", label: "Anbieter", description: "Registrierte Provider" },
  {
    id: "connections",
    label: "Verbindungsprofile",
    description: "Ohne Geheimnisse, Hosts maskiert",
  },
  { id: "settings", label: "Einstellungen", description: "Bereinigte Anwendungseinstellungen" },
  { id: "errors", label: "Letzte Fehler", description: "Zuletzt aufgetretene Fehlermeldungen" },
];

export interface DiagnosticsApp {
  name: string;
  version: string;
}

export interface DiagnosticsSystem {
  os: string;
  platform: string;
  language: string;
  timezone: string;
}

export interface DiagnosticsDriver {
  kind: DatabaseKind;
  title: string;
  type: string;
  available: boolean;
  detail: string;
}

export interface DiagnosticsProvider {
  id: string;
  name: string;
  kind: DatabaseKind;
  group: string;
  driverAvailable: boolean;
}

export interface DiagnosticsConnection {
  name: string;
  kind: DatabaseKind;
  scheme: string;
  host: string;
  port: number | null;
  sslMode: string;
  usesSsh: boolean;
  tagCount: number;
}

export interface DiagnosticsError {
  at: string;
  source: string;
  message: string;
}

export interface DiagnosticsPackage {
  format: typeof DIAGNOSTICS_FORMAT;
  version: number;
  createdAt: string;
  sections: DiagnosticsSectionId[];
  warnings: string[];
  app?: DiagnosticsApp;
  system?: DiagnosticsSystem;
  drivers?: DiagnosticsDriver[];
  providers?: DiagnosticsProvider[];
  connections?: DiagnosticsConnection[];
  settings?: Record<string, unknown>;
  errors?: DiagnosticsError[];
}
