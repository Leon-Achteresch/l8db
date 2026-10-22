import { Channel } from "@tauri-apps/api/core";
import { invoke } from "./core";

export interface SupabaseEdgeFunctionDetails {
  id?: string;
  slug: string;
  name?: string;
  status?: string;
  version?: number;
  verify_jwt?: boolean;
  entrypoint_path?: string | null;
  import_map_path?: string | null;
  import_map?: boolean;
  created_at?: number | string;
  updated_at?: number | string;
  ezbr_sha256?: string;
  [key: string]: unknown;
}

export interface SupabaseEdgeSourceFile {
  path: string;
  content: string | null;
  size: number;
}

export interface SupabaseEdgeSource {
  format: "files" | "eszip";
  files: SupabaseEdgeSourceFile[];
  size: number;
}

export interface SupabaseEdgeSecret {
  name: string;
  value: string | null;
  updated_at: string | null;
}

export type SupabaseEdgeAuth = "project" | "bearer" | "none";

export interface SupabaseEdgeInvokeRequest {
  method: string;
  path: string;
  query: string;
  headers: [string, string][];
  body: string | null;
  auth: SupabaseEdgeAuth;
  bearer: string | null;
}

export interface SupabaseEdgeInvokeResponse {
  status: number;
  headers: [string, string][];
  body: string;
  size: number;
  truncated: boolean;
  duration_ms: number;
}

export interface SupabaseRealtimeChange {
  event: "*" | "INSERT" | "UPDATE" | "DELETE";
  schema: string;
  table: string | null;
  filter: string | null;
}

export type SupabaseRealtimeEvent =
  | { kind: "status"; status: "connecting" | "open" | "closed"; detail: string | null }
  | { kind: "message"; event: string; payload: unknown; received_at: number };

export interface SupabaseRealtimePublication {
  all_tables: boolean;
  insert: boolean;
  update: boolean;
  delete: boolean;
  truncate: boolean;
}

export interface SupabaseRealtimeTablesPage {
  publication: SupabaseRealtimePublication | null;
  tables: { schema: string; name: string; enabled: boolean }[];
  has_more: boolean;
}

export const supabaseEdgeFunction = (reference: string, slug: string) =>
  invoke<SupabaseEdgeFunctionDetails>("supabase_studio_edge_function", { reference, slug });
export const supabaseEdgeFunctionSource = (reference: string, slug: string) =>
  invoke<SupabaseEdgeSource>("supabase_studio_edge_function_source", { reference, slug });
export const supabaseEdgeFunctionDownload = (reference: string, slug: string) =>
  invoke<string | null>("supabase_studio_edge_function_download", { reference, slug });
export const supabaseEdgeFunctionDeploy = (
  reference: string,
  slug: string,
  name: string,
  entrypoint: string,
  importMap: string | null,
  verifyJwt: boolean,
) =>
  invoke<SupabaseEdgeFunctionDetails | null>("supabase_studio_edge_function_deploy", {
    reference,
    slug,
    name,
    entrypoint,
    importMap,
    verifyJwt,
  });
export const supabaseEdgeFunctionUpdate = (
  reference: string,
  slug: string,
  name: string,
  verifyJwt: boolean,
) =>
  invoke<SupabaseEdgeFunctionDetails>("supabase_studio_edge_function_update", {
    reference,
    slug,
    name,
    verifyJwt,
  });
export const supabaseEdgeSecrets = (reference: string) =>
  invoke<SupabaseEdgeSecret[]>("supabase_studio_edge_secrets", { reference });
export const supabaseEdgeSecretSet = (reference: string, name: string, value: string) =>
  invoke<void>("supabase_studio_edge_secret_set", { reference, name, value });
export const supabaseEdgeSecretDelete = (reference: string, name: string) =>
  invoke<void>("supabase_studio_edge_secret_delete", { reference, name });
export const supabaseEdgeInvoke = (
  reference: string,
  slug: string,
  request: SupabaseEdgeInvokeRequest,
) =>
  invoke<SupabaseEdgeInvokeResponse>("supabase_studio_edge_invoke", {
    reference,
    slug,
    ...request,
  });

export function supabaseRealtimeOpen(
  reference: string,
  session: string,
  channel: string,
  changes: SupabaseRealtimeChange[],
  presenceKey: string,
  isPrivate: boolean,
  onEvent: (event: SupabaseRealtimeEvent) => void,
) {
  const events = new Channel<SupabaseRealtimeEvent>();
  events.onmessage = onEvent;
  return invoke<void>("supabase_studio_edge_realtime_open", {
    reference,
    session,
    channel,
    changes,
    presenceKey,
    private: isPrivate,
    events,
  });
}
export const supabaseRealtimePush = (
  session: string,
  kind: "broadcast" | "track" | "untrack",
  event: string,
  payload: unknown,
) => invoke<void>("supabase_studio_edge_realtime_push", { session, kind, event, payload });
export const supabaseRealtimeClose = (session: string) =>
  invoke<void>("supabase_studio_edge_realtime_close", { session });
export const supabaseRealtimeBroadcast = (
  reference: string,
  channel: string,
  event: string,
  payload: unknown,
  isPrivate: boolean,
) =>
  invoke<void>("supabase_studio_edge_realtime_broadcast", {
    reference,
    channel,
    event,
    payload,
    private: isPrivate,
  });
export const supabaseRealtimeTables = (reference: string, search: string, offset: number) =>
  invoke<SupabaseRealtimeTablesPage>("supabase_studio_edge_publication_tables", {
    reference,
    search,
    offset,
  });
export const supabaseRealtimeToggleTable = (
  reference: string,
  schema: string,
  table: string,
  enabled: boolean,
) => invoke<void>("supabase_studio_edge_publication_toggle", { reference, schema, table, enabled });
export const supabaseRealtimePublicationActions = (
  reference: string,
  actions: Pick<SupabaseRealtimePublication, "insert" | "update" | "delete" | "truncate">,
) => invoke<void>("supabase_studio_edge_publication_actions", { reference, ...actions });
