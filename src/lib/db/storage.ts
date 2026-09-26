import { invoke } from "./core";
import type { QueryResult } from "./types";

export interface BucketInfo {
  name: string;
  creation_date: string | null;
}

export interface ObjectEntry {
  key: string;
  size: number;
  last_modified: string | null;
  etag: string | null;
  storage_class: string | null;
}

export interface ObjectListing {
  prefixes: string[];
  objects: ObjectEntry[];
  next_token: string | null;
  truncated: boolean;
}

export interface ObjectVersion {
  key: string;
  version_id: string;
  is_latest: boolean;
  delete_marker: boolean;
  size: number;
  last_modified: string | null;
  etag: string | null;
  storage_class: string | null;
}

export interface VersionListing {
  prefixes: string[];
  versions: ObjectVersion[];
  next_key_marker: string | null;
  next_version_marker: string | null;
  truncated: boolean;
}

export interface ObjectHead {
  key: string;
  version_id: string | null;
  size: number;
  content_type: string | null;
  etag: string | null;
  last_modified: string | null;
  storage_class: string;
  cache_control: string | null;
  content_disposition: string | null;
  content_encoding: string | null;
  content_language: string | null;
  expires: string | null;
  server_side_encryption: string | null;
  kms_key_id: string | null;
  retention_mode: string | null;
  retain_until: string | null;
  legal_hold: string | null;
  tag_count: number;
  replication_status: string | null;
  metadata: Record<string, string>;
  headers: Record<string, string>;
}

export interface ObjectPreview {
  content_type: string | null;
  size: number;
  truncated: boolean;
  data: string;
}

export interface ObjectRef {
  key: string;
  version_id?: string | null;
}

export interface TransferItem {
  key: string;
  version_id?: string | null;
  is_prefix: boolean;
}

export interface DeleteOutcome {
  deleted: number;
  errors: string[];
}

export interface ObjectProperties {
  content_type?: string | null;
  cache_control?: string | null;
  content_disposition?: string | null;
  content_encoding?: string | null;
  content_language?: string | null;
  expires?: string | null;
  storage_class?: string | null;
  server_side_encryption?: string | null;
  kms_key_id?: string | null;
  metadata?: Record<string, string>;
}

export interface MultipartUpload {
  key: string;
  upload_id: string;
  initiated: string | null;
  storage_class: string | null;
}

export interface BucketStats {
  objects: number;
  bytes: number;
  truncated: boolean;
  storage_classes: Record<string, number>;
}

export interface TransferSummary {
  files: number;
  bytes: number;
  errors: string[];
  cancelled: boolean;
}

export interface TransferEvent {
  id: string;
  direction: "upload" | "download";
  state: "running" | "done" | "error" | "cancelled";
  bytes_done: number;
  bytes_total: number;
  files_done: number;
  files_total: number;
  current: string | null;
  error: string | null;
}

export type BucketResource =
  | "policy"
  | "policyStatus"
  | "lifecycle"
  | "cors"
  | "encryption"
  | "tagging"
  | "object-lock"
  | "notification"
  | "replication"
  | "versioning"
  | "website"
  | "logging"
  | "acl"
  | "accelerate"
  | "requestPayment"
  | "ownershipControls"
  | "publicAccessBlock"
  | "location";

export type ObjectResource = "tagging" | "retention" | "legal-hold" | "acl";

export interface ConfigTarget {
  bucket: string;
  key?: string;
  versionId?: string | null;
}

export function s3ListBuckets(connectionString: string): Promise<BucketInfo[]> {
  return invoke("s3_list_buckets", { connectionString });
}

export function s3CreateBucket(
  connectionString: string,
  bucket: string,
  options: { region?: string; objectLock?: boolean } = {},
): Promise<void> {
  return invoke("s3_create_bucket", { connectionString, bucket, ...options });
}

export function s3DeleteBucket(
  connectionString: string,
  bucket: string,
  force = false,
): Promise<void> {
  return invoke("s3_delete_bucket", { connectionString, bucket, force });
}

export function s3ListObjects(
  connectionString: string,
  bucket: string,
  prefix: string,
  options: { delimiter?: string | null; continuationToken?: string | null; maxKeys?: number } = {},
): Promise<ObjectListing> {
  return invoke("s3_list_objects", {
    connectionString,
    bucket,
    prefix,
    delimiter: options.delimiter === undefined ? "/" : options.delimiter,
    continuationToken: options.continuationToken ?? null,
    maxKeys: options.maxKeys,
  });
}

export function s3ListObjectVersions(
  connectionString: string,
  bucket: string,
  prefix: string,
  options: {
    delimiter?: string | null;
    keyMarker?: string | null;
    versionMarker?: string | null;
  } = {},
): Promise<VersionListing> {
  return invoke("s3_list_object_versions", {
    connectionString,
    bucket,
    prefix,
    delimiter: options.delimiter === undefined ? "/" : options.delimiter,
    keyMarker: options.keyMarker ?? null,
    versionMarker: options.versionMarker ?? null,
  });
}

export function s3HeadObject(
  connectionString: string,
  bucket: string,
  key: string,
  versionId?: string | null,
): Promise<ObjectHead> {
  return invoke("s3_head_object", { connectionString, bucket, key, versionId });
}

export function s3PreviewObject(
  connectionString: string,
  bucket: string,
  key: string,
  maxBytes: number,
  versionId?: string | null,
): Promise<ObjectPreview> {
  return invoke("s3_preview_object", { connectionString, bucket, key, versionId, maxBytes });
}

export function s3GetObjectText(
  connectionString: string,
  bucket: string,
  key: string,
): Promise<string> {
  return invoke("s3_get_object_text", { connectionString, bucket, key });
}

export function s3PutObjectText(
  connectionString: string,
  bucket: string,
  key: string,
  text: string,
  contentType?: string,
): Promise<string | null> {
  return invoke("s3_put_object_text", { connectionString, bucket, key, text, contentType });
}

export function s3CreateFolder(
  connectionString: string,
  bucket: string,
  key: string,
): Promise<void> {
  return invoke("s3_create_folder", { connectionString, bucket, key });
}

export function s3DeleteObjects(
  connectionString: string,
  bucket: string,
  objects: ObjectRef[],
  bypassGovernance = false,
): Promise<DeleteOutcome> {
  return invoke("s3_delete_objects", { connectionString, bucket, objects, bypassGovernance });
}

export function s3DeletePrefix(
  connectionString: string,
  bucket: string,
  prefix: string,
  options: { allVersions?: boolean; bypassGovernance?: boolean } = {},
): Promise<DeleteOutcome> {
  return invoke("s3_delete_prefix", { connectionString, bucket, prefix, ...options });
}

export function s3CopyObjects(
  connectionString: string,
  sourceBucket: string,
  items: TransferItem[],
  bucket: string,
  destinationPrefix: string,
  moveItems: boolean,
): Promise<DeleteOutcome> {
  return invoke("s3_copy_objects", {
    connectionString,
    sourceBucket,
    items,
    bucket,
    destinationPrefix,
    moveItems,
  });
}

export function s3RenameObject(
  connectionString: string,
  bucket: string,
  from: string,
  to: string,
): Promise<DeleteOutcome> {
  return invoke("s3_rename_object", { connectionString, bucket, from, to });
}

export function s3RestoreVersion(
  connectionString: string,
  bucket: string,
  key: string,
  versionId: string,
): Promise<void> {
  return invoke("s3_restore_version", { connectionString, bucket, key, versionId });
}

export function s3UpdateObjectProperties(
  connectionString: string,
  bucket: string,
  key: string,
  properties: ObjectProperties,
): Promise<void> {
  return invoke("s3_update_object_properties", { connectionString, bucket, key, properties });
}

export function s3GetConfig(
  connectionString: string,
  target: ConfigTarget,
  resource: BucketResource | ObjectResource,
): Promise<string | null> {
  return invoke("s3_get_config", {
    connectionString,
    bucket: target.bucket,
    key: target.key ?? null,
    versionId: target.versionId ?? null,
    resource,
  });
}

export function s3PutConfig(
  connectionString: string,
  target: ConfigTarget,
  resource: BucketResource | ObjectResource,
  body: string,
  bypassGovernance = false,
): Promise<void> {
  return invoke("s3_put_config", {
    connectionString,
    bucket: target.bucket,
    key: target.key ?? null,
    versionId: target.versionId ?? null,
    resource,
    body,
    bypassGovernance,
  });
}

export function s3DeleteConfig(
  connectionString: string,
  target: ConfigTarget,
  resource: BucketResource | ObjectResource,
): Promise<void> {
  return invoke("s3_delete_config", {
    connectionString,
    bucket: target.bucket,
    key: target.key ?? null,
    versionId: target.versionId ?? null,
    resource,
  });
}

export function s3Presign(
  connectionString: string,
  bucket: string,
  key: string,
  options: {
    method?: "GET" | "PUT";
    expiresSecs?: number;
    versionId?: string | null;
    downloadName?: string;
  } = {},
): Promise<string> {
  return invoke("s3_presign", { connectionString, bucket, key, ...options });
}

export function s3ListMultipartUploads(
  connectionString: string,
  bucket: string,
): Promise<MultipartUpload[]> {
  return invoke("s3_list_multipart_uploads", { connectionString, bucket });
}

export function s3AbortMultipartUpload(
  connectionString: string,
  bucket: string,
  key: string,
  uploadId: string,
): Promise<void> {
  return invoke("s3_abort_multipart_upload", { connectionString, bucket, key, uploadId });
}

export function s3BucketStats(
  connectionString: string,
  bucket: string,
  prefix = "",
): Promise<BucketStats> {
  return invoke("s3_bucket_stats", { connectionString, bucket, prefix });
}

export function s3SearchObjects(
  connectionString: string,
  bucket: string,
  prefix: string,
  query: string,
  limit = 500,
): Promise<{ objects: ObjectEntry[]; truncated: boolean }> {
  return invoke("s3_search_objects", { connectionString, bucket, prefix, query, limit });
}

export function s3SelectObject(
  connectionString: string,
  bucket: string,
  key: string,
  expression: string,
): Promise<QueryResult> {
  return invoke("s3_select_object", { connectionString, bucket, key, expression });
}

export function s3Upload(
  connectionString: string,
  bucket: string,
  prefix: string,
  paths: string[],
  transferId: string,
  properties?: ObjectProperties,
): Promise<TransferSummary> {
  return invoke("s3_upload", {
    connectionString,
    bucket,
    prefix,
    paths,
    transferId,
    properties: properties ?? null,
  });
}

export function s3Download(
  connectionString: string,
  bucket: string,
  items: TransferItem[],
  target: string,
  transferId: string,
): Promise<TransferSummary> {
  return invoke("s3_download", { connectionString, bucket, items, target, transferId });
}

export function s3CancelTransfer(transferId: string): Promise<boolean> {
  return invoke("s3_cancel_transfer", { transferId });
}
