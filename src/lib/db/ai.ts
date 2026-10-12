import { Channel, invoke } from "@tauri-apps/api/core";
import type { AiRichBlock } from "@/lib/ai/rich";
import type { DatabaseKind } from "@/lib/db";
import type { MaskRule } from "@/lib/masking";

export type AiProvider =
  | "codex"
  | "claude"
  | "gemini-cli"
  | "opencode"
  | "copilot"
  | "openai"
  | "anthropic"
  | "google"
  | "compatible"
  | "ollama"
  | "lmstudio";
export interface AiPricing {
  model: string;
  inputUsd?: number | null;
  outputUsd?: number | null;
  cachedInputUsd?: number | null;
  cacheWriteUsd?: number | null;
  contextWindow?: number | null;
}
export interface AiProfile {
  id: string;
  provider: AiProvider;
  binary: string;
  home: string;
  endpoint: string;
  model: string;
  effort: string;
  mode: string;
  approval?: string;
  config?: Record<string, unknown>;
  pricing?: AiPricing;
}
export interface AiServer {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command: string;
  args: string[];
  url: string;
}
export interface AiAttachment {
  name: string;
  path: string;
  format: "csv" | "json" | "ndjson" | "xlsx" | "parquet";
  delimiter: string;
  quote: string;
  hasHeader: boolean;
  sheet: string | null;
  columns: string[];
  types: string[];
  rows: (string | null)[][];
  totalRows: number | null;
}
export interface AiKnowledge {
  rules?: string;
  notes: string;
  glossary: { term: string; meaning: string }[];
  tables: Record<string, { description: string; columns: Record<string, string> }>;
}
export interface AiMessage {
  id?: string;
  parentId?: string | null;
  role: "user" | "assistant";
  text: string;
  rich?: AiRichBlock[];
  reasoning?: string;
  error?: string;
  stopped?: boolean;
  createdAt?: number;
  durationMs?: number;
  attachments?: AiAttachment[];
  context?: string;
  contextLabels?: string[];
}
export interface AiConnection {
  id: string;
  name: string;
  kind: DatabaseKind;
  connectionString: string;
  database: string | null;
  schemas: string[];
  readOnly: boolean;
  environment: string | null;
  maskRules: MaskRule[];
  defaultSchema: string | null;
}
export interface AiRunRequest {
  runId: string;
  profile: AiProfile;
  cwd: string;
  sessionId: string | null;
  messages: AiMessage[];
  connections: AiConnection[];
  activeId: string | null;
  skills: string[];
  servers: AiServer[];
  allowWrites: boolean;
  allowDdl: boolean;
  attachments: AiAttachment[];
}
export interface AiEvent {
  kind: string;
  data: Record<string, unknown>;
}
export interface AiModel {
  id: string;
  name: string;
  efforts?: unknown[];
}
export interface AiModels {
  models: AiModel[];
  modes?: unknown;
  configOptions?: unknown[];
  commands?: unknown[];
}
export interface AiStatus {
  provider: string;
  installed: boolean;
  version: string | null;
  keyStored: boolean;
}
export const aiEnvironment = () => invoke<{ cwd: string }>("ai_environment");
export const aiStatus = (profile: AiProfile) => invoke<AiStatus>("ai_status", { profile });
export const aiSetKey = (id: string, key: string) => invoke<void>("ai_set_key", { id, key });
export const aiModels = (profile: AiProfile, cwd?: string) =>
  invoke<AiModels>("ai_models", { profile, cwd });
export const aiSkills = (cwd: string, profile: AiProfile) =>
  invoke<{ name: string; path: string }[]>("ai_skills", { cwd, profile });
export function aiRun(request: AiRunRequest, onEvent: (event: AiEvent) => void) {
  const events = new Channel<AiEvent>();
  events.onmessage = onEvent;
  return invoke<void>("ai_run", { request, events });
}
export const aiCancel = (runId: string) => invoke<void>("ai_cancel", { runId });
export const aiApprove = (runId: string, approvalId: string, allow: boolean) =>
  invoke<void>("ai_approve", { runId, approvalId, allow });
export const aiRespond = (runId: string, approvalId: string, answer: unknown) =>
  invoke<void>("ai_respond", { runId, approvalId, answer });
export const aiKnowledgeGet = (connectionId: string) =>
  invoke<AiKnowledge>("ai_knowledge_get", { connectionId });
export const aiKnowledgeSet = (connectionId: string, knowledge: AiKnowledge) =>
  invoke<AiKnowledge>("ai_knowledge_set", { connectionId, knowledge });
export interface AiCompleteRequest {
  runId: string;
  profile: AiProfile;
  cached: string;
  system: string;
  messages: { role: "user" | "assistant"; text: string }[];
  maxTokens: number;
  stop?: string[];
  cacheKey?: string;
}
export interface AiCompleteResult {
  text: string;
  truncated: boolean;
  model: string;
}
export function aiComplete(request: AiCompleteRequest, onEvent: (event: AiEvent) => void) {
  const events = new Channel<AiEvent>();
  events.onmessage = onEvent;
  return invoke<AiCompleteResult>("ai_complete", { request, events });
}
export const aiCompleteCancel = (runId: string) => invoke<void>("ai_complete_cancel", { runId });
