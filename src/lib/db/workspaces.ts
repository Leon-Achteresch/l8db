import { invoke } from "./core";
import type { DatabaseKind } from "./providers";
import type { QueryResult } from "./types";

export interface WorkspaceUser {
  id: string;
  email: string;
  role: "admin" | "member";
  active: boolean;
}

export interface WorkspaceProfile {
  id: string;
  endpoint: string;
  user: WorkspaceUser;
}

export interface WorkspaceConnection {
  id: string;
  name: string;
  kind: DatabaseKind;
  database: string | null;
  access: "read" | "write";
  requireApproval: boolean;
}

export interface WorkspaceQuery {
  id: string;
  connectionId: string;
  name: string;
  sql: string;
  author: string;
  revision: number;
}

export interface WorkspacePending {
  id: string;
  connectionId: string;
  author: string;
  sql: string;
  status: "pending" | "running" | "rejected" | "executed" | "failed" | "cancelled";
  createdAt: number;
}

export type WorkspaceQuerySummary = Omit<WorkspaceQuery, "sql"> & { sqlPreview: string };
export type WorkspacePendingSummary = Omit<WorkspacePending, "sql"> & { sqlPreview: string };

export interface WorkspaceLog {
  id: number;
  actor: string;
  action: string;
  connectionId: string | null;
  outcome: string;
  createdAt: number;
}

export interface WorkspaceInvitation {
  id: string;
  email: string;
  role: "admin" | "member";
  expiresAt: number;
}

export interface WorkspaceGrant {
  userId: string;
  email: string;
  access: "read" | "write";
}

export interface WorkspacePage<T> {
  items: T[];
  more: boolean;
}

export interface LocalWorkspace {
  endpoint: string;
  root: string;
}

export const workspaceProfiles = () => invoke<WorkspaceProfile[]>("workspace_profiles");
export const workspaceLogin = (endpoint: string, email: string, password: string) =>
  invoke<WorkspaceProfile>("workspace_login", { endpoint, email, password });
export const workspaceAcceptInvitation = (
  endpoint: string,
  token: string,
  email: string,
  password: string,
) => invoke<void>("workspace_accept_invitation", { endpoint, token, email, password });
export const workspaceDisconnect = (profile: string) =>
  invoke<void>("workspace_disconnect", { profile });
export const workspaceLocalStatus = () => invoke<LocalWorkspace | null>("workspace_local_status");
export const workspaceLocalStart = (email: string, password: string) =>
  invoke<LocalWorkspace>("workspace_local_start", { email, password });
export const workspaceLocalStop = () => invoke<void>("workspace_local_stop");

export const workspaceRequest = <T>(
  profile: string,
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
) => invoke<T>("workspace_request", { request: { profile, method, path, body } });

export const workspaceRunQuery = (
  profile: string,
  connectionId: string,
  sql: string,
  jobId: string,
) =>
  workspaceRequest<QueryResult>(profile, "POST", `connections/${connectionId}/query`, {
    sql,
    jobId,
    maxRows: 1000,
  });

export const workspaceCancelQuery = (profile: string, connectionId: string, jobId: string) =>
  workspaceRequest<{ cancelled: boolean }>(profile, "POST", `connections/${connectionId}/cancel`, {
    jobId,
  });

export function workspaceConnectionUrl(profile: string, connectionId: string): string {
  return `workspace://${profile}/${connectionId}`;
}
