import { invoke } from "@tauri-apps/api/core";
import type { SavedConnection } from "@/lib/connections";
import { useConnectionsStore } from "@/lib/connections";
import type { DatabaseKind } from "@/lib/db";
import { scrubUrlPassword } from "@/lib/secrets";

export interface RedactRule {
  name: string;
  pattern: string;
  enabled: boolean;
}

export interface Redaction {
  columns: RedactRule[];
  values: RedactRule[];
  replacement: string;
}

export interface McpConnection {
  id: string;
  name: string;
  kind: DatabaseKind;
  connectionString: string;
  schemas: string[];
  ssh: boolean;
  exposed: boolean;
  readOnly: boolean;
  allowDdl: boolean;
  redactColumns: string[];
}

export interface McpConfig {
  enabled: boolean;
  maxRows: number;
  maxCellChars: number;
  maxChars: number;
  queryTimeout: number;
  redaction: Redaction;
  connections: McpConnection[];
}

export interface McpClient {
  id: string;
  name: string;
  configPath: string;
  installed: boolean;
  registered: boolean;
}

export interface McpAuditEntry {
  ts: string;
  connection: string;
  tool: string;
  sql: string;
  ok: boolean;
  ms: number;
  error?: string | null;
}

export const MCP_SQL_KINDS: DatabaseKind[] = [
  "postgres",
  "mysql",
  "sqlite",
  "mssql",
  "clickhouse",
  "oracle",
  "cassandra",
  "duckdb",
  "odbc",
  "mongodb",
  "redis",
];

export function mcpSupported(connection: Pick<SavedConnection, "kind" | "ssh">): string | null {
  if (connection.ssh?.host) return "SSH-Tunnel werden vom MCP nicht unterstützt";
  if (!MCP_SQL_KINDS.includes(connection.kind))
    return "Datenbanktyp wird vom MCP nicht unterstützt";
  return null;
}

export function mcpConnectionUnsupported(connection: McpConnection): string | null {
  if (connection.ssh) return "SSH-Tunnel nicht unterstützt";
  if (!MCP_SQL_KINDS.includes(connection.kind))
    return "Datenbanktyp wird vom MCP nicht unterstützt";
  return null;
}

export function mergeMcpConnections(
  saved: SavedConnection[],
  existing: McpConnection[],
): McpConnection[] {
  const byId = new Map(existing.map((entry) => [entry.id, entry]));
  return saved.map((connection) => {
    const previous = byId.get(connection.id);
    return {
      id: connection.id,
      name: connection.name,
      kind: connection.kind,
      connectionString: scrubUrlPassword(connection.connectionString),
      schemas: connection.schemas ?? [],
      ssh: Boolean(connection.ssh?.host),
      exposed: previous?.exposed ?? false,
      readOnly: previous?.readOnly ?? true,
      allowDdl: previous?.allowDdl ?? false,
      redactColumns: previous?.redactColumns ?? [],
    };
  });
}

export function sameMcpConnections(a: McpConnection[], b: McpConnection[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function loadMcpConfig(): Promise<McpConfig> {
  return invoke("mcp_config");
}

export function saveMcpConfig(config: McpConfig): Promise<void> {
  return invoke("mcp_save_config", { config });
}

export function defaultRedaction(): Promise<Redaction> {
  return invoke("mcp_default_redaction");
}

export function listMcpClients(): Promise<McpClient[]> {
  return invoke("mcp_clients");
}

export function registerMcpClient(id: string, on: boolean): Promise<McpClient[]> {
  return invoke("mcp_register", { id, on });
}

export function mcpServerCommand(): Promise<string> {
  return invoke("mcp_server_command");
}

export function redactPreview(config: McpConfig, column: string, text: string): Promise<string> {
  return invoke("mcp_redact_preview", { config, column, text });
}

export function mcpAuditTail(lines = 50): Promise<McpAuditEntry[]> {
  return invoke("mcp_audit_tail", { lines });
}

export function clearMcpAudit(): Promise<void> {
  return invoke("mcp_clear_audit");
}

export async function syncMcpConfig(): Promise<McpConfig> {
  const config = await loadMcpConfig();
  const merged = mergeMcpConnections(
    useConnectionsStore.getState().connections,
    config.connections,
  );
  if (sameMcpConnections(merged, config.connections)) return config;
  const next = { ...config, connections: merged };
  await saveMcpConfig(next);
  return next;
}

let syncing = false;

export function initMcpSync(): void {
  if (syncing) return;
  syncing = true;
  const run = () => void syncMcpConfig().catch(() => undefined);
  run();
  let last = useConnectionsStore.getState().connections;
  useConnectionsStore.subscribe((state) => {
    if (state.connections === last) return;
    last = state.connections;
    run();
  });
}
