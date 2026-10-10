import { invoke } from "./core";

export type SyncProvider = "webdav" | "gist";

export interface WebdavTarget {
  provider: "webdav";
  url: string;
  username: string;
  path: string;
  allowInsecure: boolean;
}

export interface GistTarget {
  provider: "gist";
  gistId: string | null;
}

export type SyncTarget = WebdavTarget | GistTarget;

export interface SyncRemoteFile {
  content: string | null;
  version: string | null;
  gistId: string | null;
}

export interface SyncStoreResult {
  version: string | null;
  gistId: string | null;
  conflict: boolean;
  warning: string | null;
}

export interface SyncSealed {
  envelope: string;
  fingerprint: string;
  salt: string;
}

export interface SyncBackupInfo {
  id: string;
  createdAt: number;
  reason: string;
  size: number;
}

export const SYNC_WEBDAV_ACCOUNT = "l8db-sync:webdav";
export const SYNC_GITHUB_ACCOUNT = "l8db-sync:github";
export const SYNC_PASSPHRASE_ACCOUNT = "l8db-sync:passphrase";

export function syncTest(target: SyncTarget, opId: string): Promise<string> {
  return invoke<string>("sync_test", { target, opId });
}

export function syncFetch(target: SyncTarget, opId: string): Promise<SyncRemoteFile> {
  return invoke<SyncRemoteFile>("sync_fetch", { target, opId });
}

export function syncStore(
  target: SyncTarget,
  content: string,
  ifMatch: string | null,
  expectAbsent: boolean,
  opId: string,
): Promise<SyncStoreResult> {
  return invoke<SyncStoreResult>("sync_store", { target, content, ifMatch, expectAbsent, opId });
}

export function syncCancel(opId: string): Promise<boolean> {
  return invoke<boolean>("sync_cancel", { opId });
}

export function syncEncrypt(plaintext: string, salt: string | null): Promise<SyncSealed> {
  return invoke<SyncSealed>("sync_encrypt", { plaintext, salt });
}

export function syncDecrypt(envelope: string): Promise<string> {
  return invoke<string>("sync_decrypt", { envelope });
}

export type SyncSecretBase = Record<string, [string, number]>;

export interface SecretMergeRequest {
  envelope: string | null;
  accounts: string[];
  base: SyncSecretBase;
  mode: "sync" | "upload" | "download";
  now: number;
  salt: string | null;
}

export interface SyncSecretMerge {
  sealed: SyncSealed | null;
  base: SyncSecretBase;
  updated: string[];
}

export function syncMergeSecrets(request: SecretMergeRequest): Promise<SyncSecretMerge> {
  return invoke<SyncSecretMerge>("sync_merge_secrets", { ...request });
}

export function syncClaimLeader(): Promise<boolean> {
  return invoke<boolean>("sync_claim_leader");
}

export function syncReleaseLeader(): Promise<void> {
  return invoke<void>("sync_release_leader");
}

export function syncBegin(): Promise<boolean> {
  return invoke<boolean>("sync_begin");
}

export function syncEnd(): Promise<void> {
  return invoke<void>("sync_end");
}

export function syncBackupSave(content: string, reason: string): Promise<SyncBackupInfo> {
  return invoke<SyncBackupInfo>("sync_backup_save", { content, reason });
}

export function syncBackupList(): Promise<SyncBackupInfo[]> {
  return invoke<SyncBackupInfo[]>("sync_backup_list");
}

export function syncBackupLoad(id: string): Promise<string> {
  return invoke<string>("sync_backup_load", { id });
}
