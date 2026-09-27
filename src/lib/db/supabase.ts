import type { BaasFilePreview } from "./baas-file";
import { invoke } from "./core";

export interface SupabaseProject {
  id: string;
  reference: string;
  name: string;
  region: string | null;
  status: string | null;
  organization_id: string | null;
  database: { host: string | null; version: string | null } | null;
}

export interface SupabaseBucket {
  id: string;
  name: string;
  public: boolean;
  created_at: string | null;
  updated_at: string | null;
}

export interface SupabaseFunction {
  id: string | null;
  slug: string;
  name: string | null;
  status: string | null;
  version: number | null;
  verify_jwt: boolean | null;
}

export interface SupabaseObject {
  name: string;
  id: string | null;
  created_at: string | null;
  updated_at: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SupabaseServiceHealth {
  name: string;
  healthy: boolean;
  status: string;
}

export interface SupabaseAuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
}

export interface SupabaseAuthUsersPage {
  users: SupabaseAuthUser[];
}

export const supabaseIsConnected = () => invoke<boolean>("supabase_is_connected");
export const supabaseConnect = (accessToken: string) =>
  invoke<SupabaseProject[]>("supabase_connect", { accessToken });
export const supabaseDisconnect = () => invoke<void>("supabase_disconnect");
export const supabaseProjects = () => invoke<SupabaseProject[]>("supabase_projects");
export const supabaseBuckets = (reference: string) =>
  invoke<SupabaseBucket[]>("supabase_buckets", { reference });
export const supabaseFunctions = (reference: string) =>
  invoke<SupabaseFunction[]>("supabase_functions", { reference });
export const supabaseHealth = (reference: string) =>
  invoke<SupabaseServiceHealth[]>("supabase_health", { reference });
export const supabaseHasProjectKey = (reference: string) =>
  invoke<boolean>("supabase_has_project_key", { reference });
export const supabaseSetProjectKey = (reference: string, apiKey: string) =>
  invoke<void>("supabase_set_project_key", { reference, apiKey });
export const supabaseImportProjectKey = (reference: string) =>
  invoke<void>("supabase_import_project_key", { reference });
export const supabaseDeleteProjectKey = (reference: string) =>
  invoke<void>("supabase_delete_project_key", { reference });
export const supabaseObjects = (
  reference: string,
  bucket: string,
  prefix: string,
  offset: number,
) => invoke<SupabaseObject[]>("supabase_objects", { reference, bucket, prefix, offset });
export const supabasePreviewObject = (reference: string, bucket: string, objectKey: string) =>
  invoke<BaasFilePreview>("supabase_preview_object", { reference, bucket, objectKey });
export const supabaseDownloadObject = (reference: string, bucket: string, objectKey: string) =>
  invoke<boolean>("supabase_download_object", { reference, bucket, objectKey });
export const supabaseAuthUsers = (reference: string, page: number) =>
  invoke<SupabaseAuthUsersPage>("supabase_auth_users", { reference, page });
