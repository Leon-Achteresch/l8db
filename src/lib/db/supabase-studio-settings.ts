import { invoke } from "./core";
import type { SupabaseProject } from "./supabase";

export interface SupabaseSettingsOverviewStats {
  database_size: number | null;
  table_count: number | null;
  auth_user_count: number | null;
  bucket_count: number | null;
  function_count: number | null;
  limit: number;
  errors: string[];
}

export interface SupabaseSettingsApiKey {
  name: string | null;
  type: string | null;
  api_key: string | null;
}

export interface SupabasePostgrestConfig {
  db_schema?: string;
  max_rows?: number;
  db_extra_search_path?: string;
  db_pool?: number | null;
}

export interface SupabasePostgrestUpdate {
  db_schema: string;
  max_rows: number;
  db_extra_search_path: string;
}

export type SupabasePostgresConfig = Record<string, string | number | boolean | null>;

export interface SupabasePoolerEntry {
  identifier?: string;
  database_type?: string;
  db_user?: string;
  db_host?: string;
  db_port?: number;
  db_name?: string;
  pool_mode?: string;
  default_pool_size?: number | null;
  max_client_conn?: number | null;
  connection_string?: string;
}

export interface SupabaseSslEnforcement {
  currentConfig?: { database?: boolean };
  appliedSuccessfully?: boolean;
}

export interface SupabaseNetworkRestrictions {
  entitlement?: string;
  status?: string;
  config?: { dbAllowedCidrs?: string[]; dbAllowedCidrsV6?: string[] };
}

export const supabaseStudioSettingsOverviewStats = (reference: string) =>
  invoke<SupabaseSettingsOverviewStats>("supabase_studio_settings_overview_stats", { reference });
export const supabaseStudioSettingsRevealKey = (reference: string) =>
  invoke<string>("supabase_studio_settings_reveal_key", { reference });
export const supabaseStudioSettingsApiKeys = (reference: string) =>
  invoke<SupabaseSettingsApiKey[]>("supabase_studio_settings_api_keys", { reference });
export const supabaseStudioSettingsReplaceSelfHostedKey = (reference: string, apiKey: string) =>
  invoke<SupabaseProject>("supabase_studio_settings_replace_self_hosted_key", {
    reference,
    apiKey,
  });
export const supabaseStudioSettingsPostgrest = (reference: string) =>
  invoke<SupabasePostgrestConfig>("supabase_studio_settings_postgrest", { reference });
export const supabaseStudioSettingsUpdatePostgrest = (
  reference: string,
  update: SupabasePostgrestUpdate,
) =>
  invoke<SupabasePostgrestConfig>("supabase_studio_settings_update_postgrest", {
    reference,
    update,
  });
export const supabaseStudioSettingsPostgresConfig = (reference: string) =>
  invoke<SupabasePostgresConfig>("supabase_studio_settings_postgres_config", { reference });
export const supabaseStudioSettingsUpdatePostgresConfig = (
  reference: string,
  settings: Record<string, string>,
  restartDatabase: boolean,
) =>
  invoke<SupabasePostgresConfig>("supabase_studio_settings_update_postgres_config", {
    reference,
    settings,
    restartDatabase,
  });
export const supabaseStudioSettingsPooler = (reference: string) =>
  invoke<SupabasePoolerEntry[]>("supabase_studio_settings_pooler", { reference });
export const supabaseStudioSettingsSslEnforcement = (reference: string) =>
  invoke<SupabaseSslEnforcement>("supabase_studio_settings_ssl_enforcement", { reference });
export const supabaseStudioSettingsUpdateSslEnforcement = (reference: string, enabled: boolean) =>
  invoke<SupabaseSslEnforcement>("supabase_studio_settings_update_ssl_enforcement", {
    reference,
    enabled,
  });
export const supabaseStudioSettingsNetworkRestrictions = (reference: string) =>
  invoke<SupabaseNetworkRestrictions>("supabase_studio_settings_network_restrictions", {
    reference,
  });
export const supabaseStudioSettingsSetPaused = (
  reference: string,
  paused: boolean,
  confirmName: string,
) => invoke<void>("supabase_studio_settings_set_paused", { reference, paused, confirmName });
