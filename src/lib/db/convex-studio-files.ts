import type { BaasFilePreview } from "./baas-file";
import { invoke } from "./core";

export interface ConvexDeploymentRef {
  profileId: string;
  projectId: number;
  deploymentName: string;
}

export interface ConvexStoredFile {
  id: string;
  creationTime: number;
  size: number;
  contentType: string | null;
  sha256: string | null;
  url: string | null;
}

export interface ConvexFilesPage {
  files: ConvexStoredFile[];
  cursor: string | null;
  hasMore: boolean;
}

export interface ConvexUploadResult {
  uploaded: { name: string; storageId: string }[];
  failed: { name: string; error: string }[];
}

export type ConvexFilesOrder = "asc" | "desc";

const target = (deployment: ConvexDeploymentRef) => ({
  id: deployment.profileId,
  projectId: deployment.projectId,
  deploymentName: deployment.deploymentName,
});

export const convexStudioFilesList = (
  deployment: ConvexDeploymentRef,
  cursor: string | null,
  order: ConvexFilesOrder,
  minCreationTime: number | null,
  maxCreationTime: number | null,
) =>
  invoke<ConvexFilesPage>("convex_studio_files_list", {
    ...target(deployment),
    cursor,
    order,
    minCreationTime,
    maxCreationTime,
  });

export const convexStudioFilesCount = (deployment: ConvexDeploymentRef) =>
  invoke<number>("convex_studio_files_count", target(deployment));

export const convexStudioFilesGet = (deployment: ConvexDeploymentRef, storageId: string) =>
  invoke<ConvexStoredFile | null>("convex_studio_files_get", {
    ...target(deployment),
    storageId,
  });

export const convexStudioFilesPreview = (deployment: ConvexDeploymentRef, storageId: string) =>
  invoke<BaasFilePreview>("convex_studio_files_preview", { ...target(deployment), storageId });

export const convexStudioFilesDownload = (deployment: ConvexDeploymentRef, storageId: string) =>
  invoke<boolean>("convex_studio_files_download", { ...target(deployment), storageId });

export const convexStudioFilesUpload = (deployment: ConvexDeploymentRef) =>
  invoke<ConvexUploadResult>("convex_studio_files_upload", target(deployment));

export const convexStudioFilesDelete = (deployment: ConvexDeploymentRef, storageIds: string[]) =>
  invoke<number>("convex_studio_files_delete", { ...target(deployment), storageIds });
