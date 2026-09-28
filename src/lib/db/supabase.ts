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
  kind: string | null;
  file_size_limit: number | null;
  allowed_mime_types: string[] | null;
}

export interface SupabaseFunction {
  id: string | null;
  slug: string;
  name: string | null;
  status: string | null;
  version: number | null;
  verify_jwt: boolean | null;
  entrypoint_path: string | null;
  import_map_path: string | null;
}

export const supabaseDeleteFunction = (reference: string, slug: string) =>
  invoke<void>("supabase_delete_function", { reference, slug });

export interface SupabaseObject {
  name: string;
  id: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_accessed_at: string | null;
  metadata: Record<string, unknown> | null;
}

export interface SupabaseServiceHealth {
  name: string;
  healthy: boolean;
  status: string;
}

export interface SupabaseBackups {
  pitr_enabled: boolean | null;
  backups: {
    id: number | null;
    is_physical_backup: boolean | null;
    status: string | null;
    inserted_at: string | null;
  }[];
  physical_backup_data: {
    earliest_physical_backup_date_unix: number | null;
    latest_physical_backup_date_unix: number | null;
  } | null;
}

export interface SupabaseAuthUser {
  id: string;
  email: string | null;
  phone: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  phone_confirmed_at: string | null;
  is_anonymous: boolean | null;
}

export interface SupabaseAuthUsersPage {
  users: SupabaseAuthUser[];
}

export const supabaseCreateAuthUser = (reference: string, email: string, password: string) =>
  invoke<void>("supabase_create_auth_user", { reference, email, password });
export const supabaseUpdateAuthUserEmail = (reference: string, userId: string, email: string) =>
  invoke<void>("supabase_update_auth_user_email", { reference, userId, email });
export const supabaseDeleteAuthUser = (reference: string, userId: string) =>
  invoke<void>("supabase_delete_auth_user", { reference, userId });

export interface SupabaseTable {
  schema: string;
  name: string;
  kind: string;
}

export interface SupabaseColumn {
  name: string;
  data_type: string;
  is_nullable: string;
}

export interface SupabaseTablesPage {
  tables: SupabaseTable[];
  has_more: boolean;
}

export interface SupabaseRowsPage {
  rows: { ordinal: number; values: Record<string, unknown> }[];
  has_more: boolean;
}

export const supabaseIsConnected = () => invoke<boolean>("supabase_is_connected");
export const supabaseConnect = (accessToken: string) =>
  invoke<SupabaseProject[]>("supabase_connect", { accessToken });
export const supabaseDisconnect = () => invoke<void>("supabase_disconnect");
export interface SupabaseDatabaseEndpoint {
  host: string;
  port: number;
  user: string;
  database: string;
}
export const supabaseDatabaseEndpoint = (reference: string) =>
  invoke<SupabaseDatabaseEndpoint>("supabase_database_endpoint", { reference });
export const supabaseProjects = () => invoke<SupabaseProject[]>("supabase_projects");
export const supabaseBuckets = (reference: string) =>
  invoke<SupabaseBucket[]>("supabase_buckets", { reference });
export const supabaseBucketDetails = (reference: string, bucket: string) =>
  invoke<SupabaseBucket>("supabase_bucket_details", { reference, bucket });
export const supabaseCreateBucket = (reference: string, name: string, isPublic: boolean) =>
  invoke<void>("supabase_create_bucket", { reference, name, public: isPublic });
export const supabaseUpdateBucketPublic = (reference: string, bucket: string, isPublic: boolean) =>
  invoke<void>("supabase_update_bucket_public", { reference, bucket, public: isPublic });
export const supabaseDeleteBucket = (reference: string, bucket: string) =>
  invoke<void>("supabase_delete_bucket", { reference, bucket });
export const supabaseFunctions = (reference: string) =>
  invoke<SupabaseFunction[]>("supabase_functions", { reference });
export const supabaseHealth = (reference: string) =>
  invoke<SupabaseServiceHealth[]>("supabase_health", { reference });
export const supabaseBackups = (reference: string) =>
  invoke<SupabaseBackups>("supabase_backups", { reference });
export const supabaseTables = (reference: string, offset: number) =>
  invoke<SupabaseTablesPage>("supabase_tables", { reference, offset });
export const supabaseTableColumns = (reference: string, schema: string, table: string) =>
  invoke<SupabaseColumn[]>("supabase_table_columns", { reference, schema, table });
export const supabaseTableRows = (
  reference: string,
  schema: string,
  table: string,
  offset: number,
) => invoke<SupabaseRowsPage>("supabase_table_rows", { reference, schema, table, offset });
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
export const supabaseUploadObject = (reference: string, bucket: string, prefix: string) =>
  invoke<string | null>("supabase_upload_object", { reference, bucket, prefix });
export const supabaseDeleteObject = (reference: string, bucket: string, objectKey: string) =>
  invoke<void>("supabase_delete_object", { reference, bucket, objectKey });
export const supabaseMoveObject = (
  reference: string,
  bucket: string,
  sourceKey: string,
  destinationKey: string,
) => invoke<void>("supabase_move_object", { reference, bucket, sourceKey, destinationKey });
export const supabasePreviewObject = (reference: string, bucket: string, objectKey: string) =>
  invoke<BaasFilePreview>("supabase_preview_object", { reference, bucket, objectKey });
export const supabaseDownloadObject = (reference: string, bucket: string, objectKey: string) =>
  invoke<boolean>("supabase_download_object", { reference, bucket, objectKey });
export const supabaseAuthUsers = (reference: string, page: number) =>
  invoke<SupabaseAuthUsersPage>("supabase_auth_users", { reference, page });
