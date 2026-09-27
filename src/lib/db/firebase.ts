import type { BaasFilePreview } from "./baas-file";
import { invoke } from "./core";

export interface FirebaseProfile {
  projectId: string;
  projectNumber: string | null;
  displayName: string | null;
  state: string | null;
}

export interface FirebaseBucket {
  name: string;
  location: string | null;
  storageClass: string | null;
  timeCreated: string | null;
}

export interface FirebaseBucketPage {
  items: FirebaseBucket[];
  nextPageToken: string | null;
}

export interface FirebaseObject {
  name: string;
  size: string | null;
  contentType: string | null;
  timeCreated: string | null;
  updated: string | null;
}

export interface FirebaseObjectPage {
  items: FirebaseObject[];
  prefixes: string[];
  nextPageToken: string | null;
}

export interface FirebaseAuthUser {
  localId: string;
  email: string | null;
  displayName: string | null;
  phoneNumber: string | null;
  emailVerified: boolean | null;
  disabled: boolean | null;
  createdAt: string | null;
  lastLoginAt: string | null;
  providerUserInfo: { providerId: string }[];
}

export interface FirebaseAuthPage {
  users: FirebaseAuthUser[];
  nextPageToken: string | null;
}

export interface FirebaseFirestoreDatabase {
  name: string;
  locationId: string | null;
  type: string | null;
  pointInTimeRecoveryEnablement: string | null;
}

export interface FirebaseFirestoreDatabases {
  databases: FirebaseFirestoreDatabase[];
  unreachable: string[];
}

export interface FirebaseFirestoreCollections {
  collectionIds: string[];
  nextPageToken: string | null;
}

export interface FirebaseFirestoreDocument {
  name: string;
  fields: Record<string, unknown>;
  createTime: string | null;
  updateTime: string | null;
}

export interface FirebaseFirestoreDocuments {
  documents: FirebaseFirestoreDocument[];
  nextPageToken: string | null;
}

export const firebaseConnect = () => invoke<FirebaseProfile | null>("firebase_connect");
export const firebaseProfiles = () => invoke<FirebaseProfile[]>("firebase_profiles");
export const firebaseDisconnect = (projectId: string) =>
  invoke<void>("firebase_disconnect", { projectId });
export const firebaseBuckets = (projectId: string, pageToken?: string) =>
  invoke<FirebaseBucketPage>("firebase_buckets", { projectId, pageToken });
export const firebaseObjects = (
  projectId: string,
  bucket: string,
  prefix: string,
  pageToken?: string,
) => invoke<FirebaseObjectPage>("firebase_objects", { projectId, bucket, prefix, pageToken });
export const firebaseUploadObject = (projectId: string, bucket: string, prefix: string) =>
  invoke<string | null>("firebase_upload_object", { projectId, bucket, prefix });
export const firebasePreviewObject = (projectId: string, bucket: string, objectName: string) =>
  invoke<BaasFilePreview>("firebase_preview_object", { projectId, bucket, objectName });
export const firebaseDownloadObject = (projectId: string, bucket: string, objectName: string) =>
  invoke<boolean>("firebase_download_object", { projectId, bucket, objectName });
export const firebaseAuthUsers = (projectId: string, pageToken?: string) =>
  invoke<FirebaseAuthPage>("firebase_auth_users", { projectId, pageToken });
export const firebaseFirestoreDatabases = (projectId: string) =>
  invoke<FirebaseFirestoreDatabases>("firebase_firestore_databases", { projectId });
export const firebaseFirestoreCollections = (
  projectId: string,
  databaseId: string,
  parentPath: string,
  pageToken?: string,
) =>
  invoke<FirebaseFirestoreCollections>("firebase_firestore_collections", {
    projectId,
    databaseId,
    parentPath,
    pageToken,
  });
export const firebaseFirestoreDocuments = (
  projectId: string,
  databaseId: string,
  collectionPath: string,
  pageToken?: string,
) =>
  invoke<FirebaseFirestoreDocuments>("firebase_firestore_documents", {
    projectId,
    databaseId,
    collectionPath,
    pageToken,
  });
