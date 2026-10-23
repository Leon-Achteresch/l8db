import {
  Activity,
  Code2,
  Database,
  FolderOpen,
  LayoutDashboard,
  type LucideIcon,
  Radio,
  Settings,
  ShieldCheck,
  SquareTerminal,
  Table2,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";
import type { SupabaseProject, SupabaseStudioCapabilities } from "@/lib/db";
import { SupabaseAuthSection } from "./auth/supabase-auth-section";
import { SupabaseDatabaseSection } from "./database/supabase-database-section";
import { SupabaseFunctionsSection } from "./functions/supabase-functions-section";
import { SupabaseLogsSection } from "./logs/supabase-logs-section";
import { SupabaseOverviewSection } from "./overview/supabase-overview-section";
import { SupabasePoliciesSection } from "./policies/supabase-policies-section";
import { SupabaseRealtimeSection } from "./realtime/supabase-realtime-section";
import { SupabaseSettingsSection } from "./settings/supabase-settings-section";
import { SupabaseSqlSection } from "./sql/supabase-sql-section";
import { SupabaseStorageSection } from "./storage/supabase-storage-section";
import { SupabaseTablesSection } from "./tables/supabase-tables-section";

export interface SupabaseStudioSectionProps {
  project: SupabaseProject;
  capabilities: SupabaseStudioCapabilities;
}

export type SupabaseStudioSectionId =
  | "overview"
  | "tables"
  | "sql"
  | "database"
  | "policies"
  | "auth"
  | "storage"
  | "functions"
  | "realtime"
  | "logs"
  | "settings";

export interface SupabaseStudioSection {
  id: SupabaseStudioSectionId;
  label: string;
  icon: LucideIcon;
  component: ComponentType<SupabaseStudioSectionProps>;
  unavailable: (capabilities: SupabaseStudioCapabilities) => string | null;
}

const needsSql = (capabilities: SupabaseStudioCapabilities) =>
  capabilities.sql
    ? null
    : "Benötigt einen Secret Key einer selbst gehosteten Instanz oder einen Supabase-Zugangstoken.";

const needsKey = (capabilities: SupabaseStudioCapabilities) =>
  capabilities.data_api ? null : "Benötigt einen Projekt-Key.";

export const SUPABASE_STUDIO_SECTIONS: SupabaseStudioSection[] = [
  {
    id: "overview",
    label: "Übersicht",
    icon: LayoutDashboard,
    component: SupabaseOverviewSection,
    unavailable: () => null,
  },
  {
    id: "tables",
    label: "Tabellen",
    icon: Table2,
    component: SupabaseTablesSection,
    unavailable: (capabilities) =>
      capabilities.sql || capabilities.data_api
        ? null
        : "Benötigt einen Projekt-Key oder SQL-Zugriff.",
  },
  {
    id: "sql",
    label: "SQL",
    icon: SquareTerminal,
    component: SupabaseSqlSection,
    unavailable: needsSql,
  },
  {
    id: "database",
    label: "Datenbank",
    icon: Database,
    component: SupabaseDatabaseSection,
    unavailable: needsSql,
  },
  {
    id: "policies",
    label: "Richtlinien",
    icon: ShieldCheck,
    component: SupabasePoliciesSection,
    unavailable: needsSql,
  },
  {
    id: "auth",
    label: "Auth",
    icon: Users,
    component: SupabaseAuthSection,
    unavailable: (capabilities) =>
      capabilities.service_key ? null : "Benötigt einen Secret oder service_role Key.",
  },
  {
    id: "storage",
    label: "Storage",
    icon: FolderOpen,
    component: SupabaseStorageSection,
    unavailable: needsKey,
  },
  {
    id: "functions",
    label: "Edge Functions",
    icon: Code2,
    component: SupabaseFunctionsSection,
    unavailable: (capabilities) =>
      capabilities.management || capabilities.data_api ? null : "Benötigt einen Projekt-Key.",
  },
  {
    id: "realtime",
    label: "Realtime",
    icon: Radio,
    component: SupabaseRealtimeSection,
    unavailable: needsKey,
  },
  {
    id: "logs",
    label: "Logs & Leistung",
    icon: Activity,
    component: SupabaseLogsSection,
    unavailable: (capabilities) =>
      capabilities.sql || capabilities.management
        ? null
        : "Benötigt SQL-Zugriff oder einen Supabase-Zugangstoken.",
  },
  {
    id: "settings",
    label: "Einstellungen",
    icon: Settings,
    component: SupabaseSettingsSection,
    unavailable: () => null,
  },
];
