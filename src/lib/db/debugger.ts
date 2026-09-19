import { confirmSqlExecution, invoke } from "./core";
import type { DatabaseKind } from "./providers";

export interface DebugContext {
  kind: DatabaseKind;
  connectionString: string;
  database?: string;
}

export interface DebugAvailability {
  available: boolean;
  engine: string | null;
  message: string;
  stepOut: boolean;
}

export interface DebugBreakpoint {
  oid: string;
  line: number;
}

export interface DebugFrame {
  id: number;
  oid: string;
  name: string;
  line: number;
}

export interface DebugSnapshot {
  id: string;
  status: "starting" | "running" | "paused" | "finished" | "error" | "stopped";
  message: string | null;
  frames: DebugFrame[];
  variables: { name: string; value: string | null; datatype: string }[];
  source: string;
  selectedFrame: number;
  watches: { name: string; value: string | null; error: string | null }[];
}

export type DebugAction =
  | { type: "continue" | "step_into" | "step_over" | "step_out" }
  | { type: "select_frame"; frame: number }
  | { type: "watches"; names: string[] }
  | { type: "breakpoints"; breakpoints: DebugBreakpoint[] };

export function debugAvailability(context: DebugContext): Promise<DebugAvailability> {
  return invoke("debug_availability", { ...context });
}

export async function debugLaunch(
  context: DebugContext,
  request: { id: string; oid: string; sql: string; breakpoints: DebugBreakpoint[] },
): Promise<DebugSnapshot> {
  await confirmSqlExecution(context.kind, context.connectionString, request.sql, context.database);
  return invoke("debug_launch", { ...context, request });
}

export function debugSnapshot(context: DebugContext, id: string): Promise<DebugSnapshot> {
  return invoke("debug_snapshot", { ...context, id });
}

export function debugAction(context: DebugContext, id: string, action: DebugAction): Promise<void> {
  return invoke("debug_action", { ...context, id, action });
}

export function debugStop(context: DebugContext, id: string): Promise<void> {
  return invoke("debug_stop", { ...context, id });
}
