import { Braces, ChartColumn, FileText, type LucideIcon, Plug, Table2, Zap } from "lucide-react";
import type { DatabaseKind, ProviderInfo } from "@/lib/db";

export type CategoryId = "sql" | "file" | "documents" | "cache" | "analytics" | "other";

export interface Category {
  id: CategoryId;
  title: string;
  question: string;
  description: string;
  icon: LucideIcon;
}

export const CATEGORIES: Category[] = [
  {
    id: "sql",
    title: "SQL-Datenbank",
    question: "Auf einem Server oder in der Cloud",
    description: "Tabellen mit Zeilen und Spalten. Typisch für Web-Apps und Firmensoftware.",
    icon: Table2,
  },
  {
    id: "file",
    title: "Datei",
    question: "Liegt als Datei auf meinem Rechner",
    description: "Eine .db-, .sqlite- oder .duckdb-Datei. Kein Server, kein Passwort.",
    icon: FileText,
  },
  {
    id: "documents",
    title: "Dokumente & NoSQL",
    question: "Daten als JSON-Dokumente",
    description: "Flexible Datensätze ohne festes Schema, z. B. MongoDB.",
    icon: Braces,
  },
  {
    id: "cache",
    title: "Key-Value & Cache",
    question: "Schneller Zwischenspeicher",
    description: "Schlüssel und Werte im Arbeitsspeicher, z. B. Redis für Sessions.",
    icon: Zap,
  },
  {
    id: "analytics",
    title: "Analyse & Suche",
    question: "Große Datenmengen auswerten",
    description: "Data Warehouses, Zeitreihen und Suchindizes für Reports.",
    icon: ChartColumn,
  },
  {
    id: "other",
    title: "Sonstige",
    question: "Etwas anderes",
    description: "Alles mit ODBC-Treiber, etwa Access, DB2 oder Firebird.",
    icon: Plug,
  },
];

const CATEGORY_BY_KIND: Record<DatabaseKind, CategoryId> = {
  postgres: "sql",
  mysql: "sql",
  mssql: "sql",
  oracle: "sql",
  sqlite_http: "sql",
  sqlite: "file",
  duckdb: "file",
  mongodb: "documents",
  dynamodb: "documents",
  cassandra: "documents",
  redis: "cache",
  clickhouse: "analytics",
  influxdb: "analytics",
  elasticsearch: "analytics",
  bigquery: "analytics",
  snowflake: "analytics",
  athena: "analytics",
  odbc: "other",
};

export const POPULAR_IDS = ["postgres", "mysql", "sqlite", "mssql", "mongodb", "redis"];

export const POPULAR_NOTES: Record<string, string> = {
  postgres: "Allrounder für Web-Apps",
  mysql: "Klassiker bei Webhostern",
  sqlite: "Einzelne Datei, kein Server",
  mssql: "Microsoft & Firmen-IT",
  mongodb: "JSON-Dokumente",
  redis: "Cache & Sessions",
};

export function categoryOf(provider: ProviderInfo): CategoryId {
  return CATEGORY_BY_KIND[provider.kind];
}

export function matchesProvider(provider: ProviderInfo, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [provider.name, provider.id, provider.group, ...provider.url_schemes].some((value) =>
    value.toLowerCase().includes(needle),
  );
}

export function connectionNeeds(provider: ProviderInfo): string {
  if (provider.file_based) return "Pfad zur Datei";
  if (provider.default_port) return `Host, Port ${provider.default_port}, Benutzer und Passwort`;
  return "Zugangsdaten des Anbieters";
}
