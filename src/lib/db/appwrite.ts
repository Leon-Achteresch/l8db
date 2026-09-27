import type { BaasFilePreview } from "./baas-file";
import { invoke } from "./core";

export interface AppwriteProfile {
  id: string;
  endpoint: string;
  project_id: string;
  name: string;
  region: string | null;
}

export interface AppwritePage<T> {
  total: number;
  items: T[];
}

export interface AppwriteBucket {
  id: string;
  name: string;
  enabled: boolean;
  total_size: number | null;
}

export interface AppwriteFile {
  id: string;
  name: string;
  size_original: number | null;
  mime_type: string | null;
  created_at: string | null;
}

export interface AppwriteNamedResource {
  id: string;
  name: string;
  enabled: boolean | null;
  created_at: string | null;
}

export interface AppwriteUser {
  id: string;
  name: string;
  email: string | null;
  status: boolean | null;
  created_at: string | null;
}

export interface AppwriteRow {
  $id: string;
  [key: string]: unknown;
}

export const appwriteConnect = (endpoint: string, projectId: string, apiKey: string) =>
  invoke<AppwriteProfile>("appwrite_connect", { endpoint, projectId, apiKey });
export const appwriteProfiles = () => invoke<AppwriteProfile[]>("appwrite_profiles");
export const appwriteDisconnect = (id: string) => invoke<void>("appwrite_disconnect", { id });
export const appwriteBuckets = (id: string, offset: number) =>
  invoke<AppwritePage<AppwriteBucket>>("appwrite_buckets", { id, offset });
export const appwriteFiles = (id: string, bucketId: string, offset: number) =>
  invoke<AppwritePage<AppwriteFile>>("appwrite_files", { id, bucketId, offset });
export const appwritePreviewFile = (id: string, bucketId: string, fileId: string) =>
  invoke<BaasFilePreview>("appwrite_preview_file", { id, bucketId, fileId });
export const appwriteDownloadFile = (id: string, bucketId: string, fileId: string, name: string) =>
  invoke<boolean>("appwrite_download_file", { id, bucketId, fileId, name });
export const appwriteDatabases = (id: string, offset: number) =>
  invoke<AppwritePage<AppwriteNamedResource>>("appwrite_databases", { id, offset });
export const appwriteTables = (id: string, databaseId: string, offset: number) =>
  invoke<AppwritePage<AppwriteNamedResource>>("appwrite_tables", { id, databaseId, offset });
export const appwriteRows = (id: string, databaseId: string, tableId: string, offset: number) =>
  invoke<AppwritePage<AppwriteRow>>("appwrite_rows", { id, databaseId, tableId, offset });
export const appwriteFunctions = (id: string, offset: number) =>
  invoke<AppwritePage<AppwriteNamedResource>>("appwrite_functions", { id, offset });
export const appwriteUsers = (id: string, offset: number) =>
  invoke<AppwritePage<AppwriteUser>>("appwrite_users", { id, offset });
export const appwriteSites = (id: string, offset: number) =>
  invoke<AppwritePage<AppwriteNamedResource>>("appwrite_sites", { id, offset });
