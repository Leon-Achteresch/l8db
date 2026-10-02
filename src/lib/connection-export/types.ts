import type {
  ConnectionEnvironment,
  ConnectionTag,
  NetworkProxy,
  SshAuth,
  SshJumpHost,
} from "@/lib/connections";
import type { DatabaseKind, SslMode } from "@/lib/db";
import type { MaskRule } from "@/lib/masking";

export const CONNECTION_EXPORT_FORMAT = "l8db-connections";

export const CONNECTION_EXPORT_VERSION = 1;

export const KINDS: DatabaseKind[] = [
  "postgres",
  "mysql",
  "sqlite",
  "mssql",
  "clickhouse",
  "mongodb",
  "redis",
  "oracle",
  "cassandra",
  "duckdb",
  "odbc",
  "elasticsearch",
  "influxdb",
  "sqlite_http",
  "dynamodb",
  "athena",
  "bigquery",
  "snowflake",
];

export const SSL_MODES: SslMode[] = ["disable", "prefer", "require", "verify-ca", "verify-full"];

export const ENVIRONMENTS: ConnectionEnvironment[] = [
  "development",
  "test",
  "staging",
  "production",
];

export const SECRET_PARAM =
  /^(password|passwd|pwd|pass|token|secret|api[_-]?key|access[_-]?key|secret[_-]?key|auth[_-]?token|credential[s]?|sslpassword|ssl[_-]?key[_-]?password|passphrase)$/i;

export interface ExportedSsh {
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

export interface ExportedConnection {
  id: string;
  name: string;
  kind: DatabaseKind;
  connectionString: string;
  sslMode: SslMode;
  ssh: ExportedSsh | null;
  proxy?: NetworkProxy | null;
  tags: ConnectionTag[];
  favorite: boolean;
  color: string | null;
  schemas: string[] | null;
  showSingleSchemaSwitcher: boolean;
  environment?: ConnectionEnvironment | null;
  readOnly?: boolean;
  maskRules?: MaskRule[];
}

export interface ConnectionExportFile {
  format: typeof CONNECTION_EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  connections: ExportedConnection[];
}
