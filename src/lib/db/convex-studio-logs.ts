import { invoke } from "./core";

export type ConvexLogLevel = "DEBUG" | "LOG" | "INFO" | "WARN" | "ERROR";

export interface ConvexLogLine {
  level: string;
  message: string;
  timestampMs: number | null;
  truncated: boolean;
}

export interface ConvexLogEntry {
  kind: "completion" | "progress";
  executionId: string;
  requestId: string;
  identifier: string;
  udfType: string;
  componentPath: string | null;
  timestampMs: number;
  cached: boolean;
  caller: string | null;
  parentExecutionId: string | null;
  executionTimeMs: number | null;
  userExecutionTimeMs: number | null;
  success: boolean | null;
  error: string | null;
  lines: ConvexLogLine[];
  linesDropped: number;
  usage: Record<string, number> | null;
  returnBytes: number | null;
  environment: string | null;
}

export interface ConvexLogBatch {
  entries: ConvexLogEntry[];
  newCursor: number;
  timedOut: boolean;
  dropped: number;
}

export interface ConvexLogTarget {
  profileId: string;
  projectId: number;
  deploymentName: string;
}

export const convexStudioLogsFetch = (
  target: ConvexLogTarget,
  streamId: string,
  cursor: number,
  waitMs: number,
) =>
  invoke<ConvexLogBatch>("convex_studio_logs_fetch", {
    id: target.profileId,
    projectId: target.projectId,
    deploymentName: target.deploymentName,
    streamId,
    cursor,
    waitMs,
  });

export const convexStudioLogsCancel = (streamId: string) =>
  invoke<void>("convex_studio_logs_cancel", { streamId });
