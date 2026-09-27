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
export const pocketbaseRecords = (id: string, collectionId: string, page: number) =>
  invoke<PocketBasePage<PocketBaseRecord>>("pocketbase_records", { id, collectionId, page });
export const pocketbasePreviewFile = (
  id: string,
  collectionId: string,
  recordId: string,
  filename: string,
) => invoke<BaasFilePreview>("pocketbase_preview_file", { id, collectionId, recordId, filename });
