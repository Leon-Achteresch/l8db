import { invoke } from "./core";
import type { SupabaseBucket, SupabaseObject } from "./supabase";

export interface SupabaseStorageBucketsPage {
  buckets: SupabaseBucket[];
  has_more: boolean;
}

export interface SupabaseStorageObjectsPage {
  objects: SupabaseObject[];
  has_more: boolean;
}

export interface SupabaseStorageUploadResult {
  uploaded: string[];
  failed: { name: string; error: string }[];
}

export interface SupabaseStorageObjectInfo {
  id: string | null;
  name: string | null;
  version: string | null;
  bucket_id: string | null;
  size: number | null;
  content_type: string | null;
  cache_control: string | null;
  content_encoding: string | null;
  etag: string | null;
  metadata: Record<string, unknown> | null;
  last_modified: string | null;
  created_at: string | null;
}

export interface SupabaseStorageBucketSettings {
  public: boolean;
  fileSizeLimit: number | null;
  allowedMimeTypes: string[];
}

export const supabaseStudioStorageBuckets = (reference: string, search: string, offset: number) =>
  invoke<SupabaseStorageBucketsPage>("supabase_studio_storage_buckets", {
    reference,
    search,
    offset,
  });

export const supabaseStudioStorageBucketCreate = (
  reference: string,
  bucket: string,
  settings: SupabaseStorageBucketSettings,
) => invoke<void>("supabase_studio_storage_bucket_create", { reference, bucket, ...settings });

export const supabaseStudioStorageBucketUpdate = (
  reference: string,
  bucket: string,
  settings: SupabaseStorageBucketSettings,
) => invoke<void>("supabase_studio_storage_bucket_update", { reference, bucket, ...settings });

export const supabaseStudioStorageBucketEmpty = (reference: string, bucket: string) =>
  invoke<void>("supabase_studio_storage_bucket_empty", { reference, bucket });

export const supabaseStudioStorageObjects = (
  reference: string,
  bucket: string,
  prefix: string,
  search: string,
  offset: number,
) =>
  invoke<SupabaseStorageObjectsPage>("supabase_studio_storage_objects", {
    reference,
    bucket,
    prefix,
    search,
    offset,
  });

export const supabaseStudioStorageUpload = (
  reference: string,
  bucket: string,
  prefix: string,
  upsert: boolean,
) =>
  invoke<SupabaseStorageUploadResult>("supabase_studio_storage_upload", {
    reference,
    bucket,
    prefix,
    upsert,
  });

export const supabaseStudioStorageCreateFolder = (
  reference: string,
  bucket: string,
  prefix: string,
  name: string,
) => invoke<string>("supabase_studio_storage_create_folder", { reference, bucket, prefix, name });

export const supabaseStudioStorageTransfer = (
  reference: string,
  bucket: string,
  source: string,
  destinationBucket: string,
  destination: string,
  copy: boolean,
) =>
  invoke<number>("supabase_studio_storage_transfer", {
    reference,
    bucket,
    source,
    destinationBucket,
    destination,
    copy,
  });

export const supabaseStudioStorageDelete = (reference: string, bucket: string, paths: string[]) =>
  invoke<number>("supabase_studio_storage_delete", { reference, bucket, paths });

export const supabaseStudioStorageSignedUrl = (
  reference: string,
  bucket: string,
  objectKey: string,
  expiresIn: number,
  download: boolean,
) =>
  invoke<string>("supabase_studio_storage_signed_url", {
    reference,
    bucket,
    objectKey,
    expiresIn,
    download,
  });

export const supabaseStudioStoragePublicUrl = (
  reference: string,
  bucket: string,
  objectKey: string,
) => invoke<string>("supabase_studio_storage_public_url", { reference, bucket, objectKey });

export const supabaseStudioStorageObjectInfo = (
  reference: string,
  bucket: string,
  objectKey: string,
) =>
  invoke<SupabaseStorageObjectInfo>("supabase_studio_storage_object_info", {
    reference,
    bucket,
    objectKey,
  });
