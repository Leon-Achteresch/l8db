import { invoke } from "./core";

export interface ConvexDeploymentRef {
  profileId: string;
  projectId: number;
  deploymentName: string;
}

export interface ConvexSettingsInfo {
  url: string;
  siteUrl: string;
  cloudUrl: string | null;
  state: string | null;
  version: string | null;
  nodeVersion: string | null;
  instanceName: string | null;
  kind: string | null;
  authProviders: Record<string, unknown>[];
  components: {
    id?: string;
    name?: string | null;
    path?: string;
    state?: string;
    args?: unknown;
  }[];
  errors: string[];
}

export interface ConvexSettingsStats {
  tableCount: number | null;
  documentCount: number | null;
  functionCount: number | null;
  httpRouteCount: number | null;
  fileCount: number | null;
  scheduledPending: number | null;
  scheduledHasMore: boolean;
  cronCount: number | null;
  errors: string[];
}

export interface ConvexRecentError {
  identifier: string;
  udfType: string | null;
  timestamp: number;
  message: string;
  requestId: string | null;
}

export interface ConvexEnvImportResult {
  applied: string[];
  skipped: string[];
}

export interface ConvexExportStatus {
  state: "requested" | "in_progress" | "completed" | "failed";
  start_ts: string;
  complete_ts?: string | null;
  size?: string | null;
  expiration_ts?: string | null;
  format?: { format: string; include_storage?: boolean };
}

export interface ConvexImportStatus {
  state: {
    state: "uploaded" | "waiting_for_confirmation" | "in_progress" | "completed" | "failed";
    message_to_confirm?: string;
    error_message?: string;
    progress_message?: string;
  };
  checkpoints?: {
    display_table_name: string;
    existing_rows_in_table: string;
    existing_rows_to_delete: string;
    num_rows_written: string;
    total_num_rows_to_write: string;
  }[];
  mode?: string;
}

export type ConvexImportMode = "append" | "replace" | "requireEmpty";

const args = (deployment: ConvexDeploymentRef) => ({
  id: deployment.profileId,
  projectId: deployment.projectId,
  deploymentName: deployment.deploymentName,
});

export const convexStudioSettingsInfo = (deployment: ConvexDeploymentRef) =>
  invoke<ConvexSettingsInfo>("convex_studio_settings_info", args(deployment));
export const convexStudioSettingsStats = (deployment: ConvexDeploymentRef) =>
  invoke<ConvexSettingsStats>("convex_studio_settings_stats", args(deployment));
export const convexStudioSettingsRecentErrors = (deployment: ConvexDeploymentRef) =>
  invoke<ConvexRecentError[]>("convex_studio_settings_recent_errors", args(deployment));
export const convexStudioSettingsEnvReveal = (deployment: ConvexDeploymentRef, name: string) =>
  invoke<string | null>("convex_studio_settings_env_reveal", { ...args(deployment), name });
export const convexStudioSettingsEnvImport = (
  deployment: ConvexDeploymentRef,
  text: string,
  overwrite: boolean,
) =>
  invoke<ConvexEnvImportResult>("convex_studio_settings_env_import", {
    ...args(deployment),
    text,
    overwrite,
  });
export const convexStudioSettingsEnvExport = (deployment: ConvexDeploymentRef) =>
  invoke<string | null>("convex_studio_settings_env_export", args(deployment));
export const convexStudioSettingsSetPaused = (deployment: ConvexDeploymentRef, paused: boolean) =>
  invoke<void>("convex_studio_settings_set_paused", { ...args(deployment), paused });
export const convexStudioSettingsExportRequest = (
  deployment: ConvexDeploymentRef,
  includeStorage: boolean,
) => invoke<void>("convex_studio_settings_export_request", { ...args(deployment), includeStorage });
export const convexStudioSettingsExportStatus = (deployment: ConvexDeploymentRef) =>
  invoke<ConvexExportStatus | null>("convex_studio_settings_export_status", args(deployment));
export const convexStudioSettingsExportDownload = (deployment: ConvexDeploymentRef) =>
  invoke<string | null>("convex_studio_settings_export_download", args(deployment));
export const convexStudioSettingsImportStart = (
  deployment: ConvexDeploymentRef,
  mode: ConvexImportMode,
  tableName: string | null,
) =>
  invoke<string | null>("convex_studio_settings_import_start", {
    ...args(deployment),
    mode,
    tableName,
  });
export const convexStudioSettingsImportStatus = (
  deployment: ConvexDeploymentRef,
  importId: string,
) =>
  invoke<ConvexImportStatus | null>("convex_studio_settings_import_status", {
    ...args(deployment),
    importId,
  });
export const convexStudioSettingsImportConfirm = (
  deployment: ConvexDeploymentRef,
  importId: string,
) => invoke<void>("convex_studio_settings_import_confirm", { ...args(deployment), importId });
export const convexStudioSettingsImportCancel = (
  deployment: ConvexDeploymentRef,
  importId: string,
) => invoke<void>("convex_studio_settings_import_cancel", { ...args(deployment), importId });
