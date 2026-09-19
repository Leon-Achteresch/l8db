import type { SavedConnection } from "@/lib/connections";
import type { ProviderInfo } from "@/lib/db";
import { platformOs } from "@/lib/drivers";
import type { SettingsState } from "@/lib/settings";
import { driverDiagnostics, providerDiagnostics, redactConnection, redactSettings } from "./redact";
import {
  DIAGNOSTICS_FORMAT,
  DIAGNOSTICS_SECTIONS,
  DIAGNOSTICS_VERSION,
  type DiagnosticsApp,
  type DiagnosticsError,
  type DiagnosticsPackage,
  type DiagnosticsSectionId,
  type DiagnosticsSystem,
} from "./types";

export interface DiagnosticsInput {
  app: DiagnosticsApp;
  system: DiagnosticsSystem;
  providers: ProviderInfo[];
  connections: SavedConnection[];
  settings: SettingsState;
  errors: DiagnosticsError[];
  warnings: string[];
}

export function buildDiagnosticsPackage(
  input: DiagnosticsInput,
  sections: DiagnosticsSectionId[],
  now: Date = new Date(),
): DiagnosticsPackage {
  const enabled = new Set(sections);
  const ordered = DIAGNOSTICS_SECTIONS.filter((section) => enabled.has(section.id)).map(
    (section) => section.id,
  );
  const pkg: DiagnosticsPackage = {
    format: DIAGNOSTICS_FORMAT,
    version: DIAGNOSTICS_VERSION,
    createdAt: now.toISOString(),
    sections: ordered,
    warnings: input.warnings,
  };
  if (enabled.has("app")) pkg.app = input.app;
  if (enabled.has("system")) pkg.system = input.system;
  if (enabled.has("drivers")) pkg.drivers = driverDiagnostics(input.providers);
  if (enabled.has("providers")) pkg.providers = providerDiagnostics(input.providers);
  if (enabled.has("connections"))
    pkg.connections = input.connections.map((connection) => redactConnection(connection));
  if (enabled.has("settings")) pkg.settings = redactSettings(input.settings);
  if (enabled.has("errors")) pkg.errors = input.errors;
  return pkg;
}

export function serializeDiagnostics(pkg: DiagnosticsPackage): string {
  return JSON.stringify(pkg, null, 2);
}

export function collectSystemInfo(): DiagnosticsSystem {
  const nav: Partial<Navigator> | undefined =
    typeof navigator !== "undefined" ? navigator : undefined;
  const platform = typeof nav?.platform === "string" ? nav.platform : "";
  let timezone = "";
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
  } catch {
    timezone = "";
  }
  return {
    os: platformOs(platform),
    platform,
    language: typeof nav?.language === "string" ? nav.language : "",
    timezone,
  };
}
