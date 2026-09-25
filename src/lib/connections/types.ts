import type { DatabaseKind, SslMode } from "@/lib/db";
import type { MaskRule } from "@/lib/masking";

export type ConnectionEnvironment = "development" | "test" | "staging" | "production";

export interface ConnectionTag {
  name: string;
  color: string;
}

export const TAG_COLORS = [
  "#3b82f6",
  "#f97316",
  "#22c55e",
  "#14b8a6",
  "#a855f7",
  "#ec4899",
  "#eab308",
  "#ef4444",
  "#64748b",
  "#06b6d4",
];

export interface ConnectionColor {
  value: string;
  label: string;
}

export const CONNECTION_COLORS: ConnectionColor[] = [
  { value: "#ef4444", label: "Rot" },
  { value: "#f97316", label: "Orange" },
  { value: "#eab308", label: "Gelb" },
  { value: "#22c55e", label: "Grün" },
  { value: "#3b82f6", label: "Blau" },
  { value: "#a855f7", label: "Violett" },
  { value: "#64748b", label: "Grau" },
];

export function connectionColorLabel(color: string | null | undefined): string | null {
  if (!color) return null;
  return CONNECTION_COLORS.find((entry) => entry.value === color)?.label ?? color;
}

export type SshAuth = "password" | "key" | "agent";

export interface SshJumpHost {
  host: string;
  port: number;
  user: string;
  auth: SshAuth;
  keyFile: string;
  agentSocket?: string;
}

export interface SshConnection {
  host: string;
  port: number;
  user: string;
  auth: SshAuth;
  keyFile: string;
  agentSocket?: string;
  jumpHosts?: SshJumpHost[];
  remoteHost: string;
  remotePort: number;
}

export type ProxyType = "socks5" | "http";

export interface NetworkProxy {
  type: ProxyType;
  host: string;
  port: number;
  username?: string;
}

export interface SavedConnection {
  id: string;
  name: string;
  kind: DatabaseKind;
  connectionString: string;
  sslMode: SslMode;
  ssh?: SshConnection | null;
  proxy?: NetworkProxy | null;
  tunnelPort?: number | null;
  tags?: ConnectionTag[];
  favorite?: boolean;
  color?: string | null;
  readOnly?: boolean;
  proxyUser?: string | null;
  schemas?: string[] | null;
  showSingleSchemaSwitcher?: boolean;
  environment?: ConnectionEnvironment | null;
  maskRules?: MaskRule[];
  temporary?: boolean;
}

export function usesTunnel<T extends Pick<SavedConnection, "ssh" | "proxy">>(
  connection: T | null | undefined,
): connection is T {
  return Boolean(connection?.ssh?.host || connection?.proxy?.host);
}

export function sortConnectionsByName(connections: SavedConnection[]): SavedConnection[] {
  return [...connections].sort((a, b) => a.name.localeCompare(b.name));
}

export function visibleSchemas(
  connection: Pick<SavedConnection, "schemas"> | null | undefined,
  schemas: string[],
): string[] {
  const allowed = connection?.schemas;
  if (!allowed?.length) return schemas;
  const set = new Set(allowed);
  return schemas.filter((schema) => set.has(schema));
}

export type ConnectionInput = Omit<SavedConnection, "id">;
