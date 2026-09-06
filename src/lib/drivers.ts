import type {
  DatabaseKind,
  Driver,
  DriverStatus,
  InstallHint,
  ProviderInfo,
} from "@/lib/db";

export type PlatformOs = "macos" | "linux" | "windows" | "all";

export interface DriverSummary {
  kind: DatabaseKind;
  title: string;
  typeLabel: string;
  installable: boolean;
  status: DriverStatus;
  hint?: InstallHint;
  installCommand: string | null;
  providers: ProviderInfo[];
}

export const DRIVER_FAMILY_TITLES: Record<DatabaseKind, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL / MariaDB",
  sqlite: "SQLite",
  mssql: "SQL Server",
  clickhouse: "ClickHouse",
  mongodb: "MongoDB",
  redis: "Redis",
  oracle: "Oracle",
  cassandra: "Cassandra / ScyllaDB",
  duckdb: "DuckDB",
  odbc: "ODBC",
};

export function platformOs(platform?: string): PlatformOs {
  const value =
    platform ??
    (typeof navigator !== "undefined" ? navigator.platform : "");
  if (/Mac|iPhone|iPad|iPod/i.test(value)) return "macos";
  if (/Win/i.test(value)) return "windows";
  if (/Linux/i.test(value)) return "linux";
  return "all";
}

export function hintForPlatform(
  status: DriverStatus,
  os: PlatformOs = platformOs(),
): InstallHint | undefined {
  return (
    status.install.find((hint) => hint.os === os) ??
    status.install.find((hint) => hint.os === "all")
  );
}

export function driverTypeLabel(driver: Driver): string {
  switch (driver.type) {
    case "builtin":
      return "Eingebettet";
    case "runtime_library":
      return "System-Bibliothek";
    case "odbc":
      return "ODBC";
    case "cargo_feature":
      return "Build-Feature";
  }
}

export function summarizeDrivers(
  providers: ProviderInfo[],
  os: PlatformOs = platformOs(),
): DriverSummary[] {
  const summaries: DriverSummary[] = [];
  for (const provider of providers) {
    let summary = summaries.find((entry) => entry.kind === provider.kind);
    if (!summary) {
      summary = {
        kind: provider.kind,
        title: DRIVER_FAMILY_TITLES[provider.kind],
        typeLabel: driverTypeLabel(provider.driver),
        installable: false,
        status: provider.driver_status,
        hint: undefined,
        installCommand: provider.driver_status.install_command,
        providers: [],
      };
      summaries.push(summary);
    }
    summary.providers.push(provider);
  }
  for (const summary of summaries) {
    summary.hint = hintForPlatform(summary.status, os);
    summary.installable =
      !summary.status.available && summary.installCommand !== null;
  }
  return summaries;
}
