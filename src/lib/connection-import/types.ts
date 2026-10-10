import type { ExportedConnection } from "@/lib/connection-export";
import type {
  ConnectionEnvironment,
  NetworkProxy,
  SavedConnection,
  SshAuth,
} from "@/lib/connections";
import type { DatabaseKind, SslMode } from "@/lib/db";

export type ExternalImportSource = "dbeaver" | "datagrip" | "navicat";

export interface ExternalSsh {
  host: string;
  port: number;
  user: string;
  auth: SshAuth;
  keyFile: string;
  secret: string | null;
}

export interface ExternalConnection {
  sourceId: string;
  name: string;
  folder: string;
  driver: string;
  kind: DatabaseKind | null;
  product: string;
  host: string;
  port: number | null;
  database: string;
  user: string;
  password: string | null;
  passwordHint: string | null;
  params: Array<[string, string]>;
  oracleSid: boolean;
  oracleDescriptor: string;
  srv: boolean;
  ssh: ExternalSsh | null;
  sshIssue: string | null;
  proxy: NetworkProxy | null;
  proxySecret: string | null;
  sslMode: SslMode | null;
  environment: ConnectionEnvironment | null;
  readOnly: boolean;
  issue: string | null;
}

export interface ExternalParseResult {
  connections: ExternalConnection[];
  error: string | null;
  notice: string | null;
}

export interface ExternalImportCandidate {
  index: number;
  label: string;
  folder: string;
  product: string;
  kind: DatabaseKind | null;
  endpoint: string;
  profile: ExportedConnection | null;
  password: string | null;
  sshSecret: string | null;
  proxySecret: string | null;
  skipReason: string | null;
  warnings: string[];
  missingPassword: boolean;
  duplicateOf: SavedConnection | null;
}

export interface ImportedConnectionSecrets {
  id: string;
  password: string | null;
  sshSecret: string | null;
  proxySecret: string | null;
}

export interface SecretAccounts {
  ssh: (id: string) => string;
  proxy: (id: string) => string;
}

export interface ExternalImportSummary {
  imported: number;
  skipped: number;
  missingPassword: number;
}

export interface ResolvedExternalImport {
  connections: SavedConnection[];
  secrets: ImportedConnectionSecrets[];
  summary: ExternalImportSummary;
}

export function emptyExternalConnection(sourceId: string, name: string): ExternalConnection {
  return {
    sourceId,
    name,
    folder: "",
    driver: "",
    kind: null,
    product: "",
    host: "",
    port: null,
    database: "",
    user: "",
    password: null,
    passwordHint: null,
    params: [],
    oracleSid: false,
    oracleDescriptor: "",
    srv: false,
    ssh: null,
    sshIssue: null,
    proxy: null,
    proxySecret: null,
    sslMode: null,
    environment: null,
    readOnly: false,
    issue: null,
  };
}
