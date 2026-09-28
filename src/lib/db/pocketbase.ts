import type { BaasFilePreview } from "./baas-file";
import { invoke } from "./core";

export interface PocketBaseProfile {
  id: string;
  endpoint: string;
  name: string;
}

export interface PocketBaseField {
  name: string;
  kind: string;
  hidden: boolean;
  maxSelect: number | null;
}

export interface PocketBaseCollection {
  id: string;
  name: string;
  kind: string;
  system: boolean;
  fields: PocketBaseField[];
}

export interface PocketBaseRecord {
  id: string;
  created: string | null;
  updated: string | null;
  [key: string]: unknown;
}

export interface PocketBasePage<T> {
  page: number;
  per_page: number;
  total_items: number;
  total_pages: number;
  items: T[];
}

export const pocketbaseConnect = (endpoint: string, token: string) =>
  invoke<PocketBaseProfile>("pocketbase_connect", { endpoint, token });
export const pocketbaseProfiles = () => invoke<PocketBaseProfile[]>("pocketbase_profiles");
export const pocketbaseDisconnect = (id: string) => invoke<void>("pocketbase_disconnect", { id });
export const pocketbaseCollections = (id: string, page: number) =>
  invoke<PocketBasePage<PocketBaseCollection>>("pocketbase_collections", { id, page });
export const pocketbaseCreateCollection = (id: string, name: string) =>
  invoke<PocketBaseCollection>("pocketbase_create_collection", { id, name });
export const pocketbaseRenameCollection = (id: string, collectionId: string, name: string) =>
  invoke<void>("pocketbase_rename_collection", { id, collectionId, name });
export const pocketbaseDeleteCollection = (id: string, collectionId: string) =>
  invoke<void>("pocketbase_delete_collection", { id, collectionId });
export const pocketbaseCreateAuthUser = (
  id: string,
  collectionId: string,
  email: string,
  password: string,
  data: Record<string, unknown>,
) =>
  invoke<PocketBaseRecord>("pocketbase_create_auth_user", {
    id,
    collectionId,
    email,
    password,
    data,
  });
export const pocketbaseRecords = (id: string, collectionId: string, page: number) =>
  invoke<PocketBasePage<PocketBaseRecord>>("pocketbase_records", { id, collectionId, page });
export const pocketbaseCreateRecord = (
  id: string,
  collectionId: string,
  data: Record<string, unknown>,
) => invoke<PocketBaseRecord>("pocketbase_create_record", { id, collectionId, data });
export const pocketbaseUpdateRecord = (
  id: string,
  collectionId: string,
  recordId: string,
  data: Record<string, unknown>,
) => invoke<PocketBaseRecord>("pocketbase_update_record", { id, collectionId, recordId, data });
export const pocketbaseDeleteRecord = (id: string, collectionId: string, recordId: string) =>
  invoke<void>("pocketbase_delete_record", { id, collectionId, recordId });
export const pocketbaseUploadFile = (
  id: string,
  collectionId: string,
  recordId: string,
  fieldName: string,
) => invoke<boolean>("pocketbase_upload_file", { id, collectionId, recordId, fieldName });
export const pocketbaseDeleteFile = (
  id: string,
  collectionId: string,
  recordId: string,
  fieldName: string,
  filename: string,
) => invoke<void>("pocketbase_delete_file", { id, collectionId, recordId, fieldName, filename });
export const pocketbasePreviewFile = (
  id: string,
  collectionId: string,
  recordId: string,
  filename: string,
) => invoke<BaasFilePreview>("pocketbase_preview_file", { id, collectionId, recordId, filename });
export const pocketbaseDownloadFile = (
  id: string,
  collectionId: string,
  recordId: string,
  filename: string,
) => invoke<boolean>("pocketbase_download_file", { id, collectionId, recordId, filename });
