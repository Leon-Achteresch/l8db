import type { ConnectionEnvironment, SshAuth } from "@/lib/connections";
import { decryptDbeaverCredentials } from "./crypto";
import { parseJdbcUrl, parsePort } from "./jdbc";
import { FILE_KINDS, resolveProduct } from "./products";
import {
  type ExternalConnection,
  type ExternalParseResult,
  type ExternalSsh,
  emptyExternalConnection,
} from "./types";

type Json = Record<string, unknown>;

export const DBEAVER_DATA_SOURCES = "data-sources.json";

export const DBEAVER_CREDENTIALS = "credentials-config.json";

const SSH_HANDLERS = ["ssh_tunnel", "ssh-tunnel", "sshj", "jsch"];

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function record(value: unknown): Json {
  return isRecord(value) ? value : {};
}

function environmentOf(type: string): ConnectionEnvironment | null {
  const value = type.toLowerCase();
  if (value === "prod" || value === "production") return "production";
  if (value === "test") return "test";
  if (value === "dev" || value === "development") return "development";
  return null;
}

function sshAuthOf(value: string, keyFile: string): SshAuth {
  const normalized = value.toLowerCase().replace(/[^a-z]/g, "");
  if (normalized.includes("agent")) return "agent";
  if (normalized.includes("password")) return "password";
  if (normalized.includes("key")) return "key";
  return keyFile ? "key" : "password";
}

function sshHandler(configuration: Json): [string, Json] | null {
  const handlers = record(configuration.handlers);
  for (const [id, raw] of Object.entries(handlers)) {
    const handler = record(raw);
    const type = text(handler.type).toLowerCase();
    const isSsh = SSH_HANDLERS.includes(id.toLowerCase()) || id.toLowerCase().includes("ssh");
    if (!isSsh || (type && type !== "tunnel")) continue;
    if (handler.enabled === false || text(handler.enabled) === "false") continue;
    return [id, handler];
  }
  return null;
}

function parseSsh(
  id: string,
  handler: Json,
  credentials: Json,
): { ssh: ExternalSsh | null; issue: string | null } {
  const properties = record(handler.properties);
  const secure = record(credentials[`network/${id}`]);
  const host = text(properties.host) || text(properties.sshHost) || text(handler.host);
  if (!host)
    return {
      ssh: null,
      issue: "SSH-Tunnel ist aktiv, aber der SSH-Host fehlt in der Konfiguration.",
    };
  const keyFile = text(properties.keyPath) || text(properties.privateKeyPath);
  const auth = sshAuthOf(text(properties.authType) || text(properties.auth), keyFile);
  const password = text(secure.password) || text(handler.password) || text(properties.password);
  return {
    ssh: {
      host,
      port: parsePort(properties.port) ?? 22,
      user:
        text(secure.user) ||
        text(handler.user) ||
        text(properties.user) ||
        text(properties.userName),
      auth,
      keyFile: auth === "key" ? keyFile : "",
      secret: auth === "agent" ? null : password || null,
    },
    issue: null,
  };
}

function parseEntry(id: string, raw: Json, credentials: Json): ExternalConnection {
  const configuration = record(raw.configuration);
  const name = text(raw.name) || id;
  const connection = emptyExternalConnection(id, name);
  const provider = text(raw.provider);
  const driver = text(raw.driver);
  const url = text(configuration.url);
  const target = url ? parseJdbcUrl(url) : null;
  connection.folder = text(raw.folder);
  connection.driver = [provider, driver].filter(Boolean).join(" / ");
  const product = resolveProduct([driver, provider, target?.subprotocol ?? ""]);
  connection.kind = product?.kind ?? null;
  connection.product = product?.label ?? "";
  connection.environment = environmentOf(text(configuration.type));
  connection.readOnly = raw["read-only"] === true || configuration["read-only"] === true;
  const stored = record(credentials[id]);
  const secure = record(stored["#connection"]);
  const inline = record(configuration.credentials);
  connection.user =
    text(secure.user) ||
    text(inline.user) ||
    text(configuration.user) ||
    text(raw.user) ||
    (target?.user ?? "");
  const password =
    text(secure.password) ||
    text(inline.password) ||
    text(configuration.password) ||
    (target?.password ?? "");
  connection.password = password || null;
  if (!connection.password && raw["save-password"] === false)
    connection.passwordHint = "Passwort war in DBeaver nicht gespeichert.";
  if (connection.kind && FILE_KINDS.includes(connection.kind)) {
    connection.database =
      text(configuration.database) || target?.path || text(configuration.host) || "";
    return connection;
  }
  connection.host = text(configuration.host) || target?.host || "";
  connection.port = parsePort(configuration.port) ?? target?.port ?? null;
  connection.database = text(configuration.database) || target?.database || "";
  connection.params = target?.params ?? [];
  connection.oracleSid =
    target?.oracleSid ||
    text(record(configuration["provider-properties"])["@dbeaver-sid-service@"]).toUpperCase() ===
      "SID";
  connection.oracleDescriptor = target?.oracleDescriptor ?? "";
  connection.srv = target?.srv ?? false;
  const handler = sshHandler(configuration);
  if (handler) {
    const { ssh, issue } = parseSsh(handler[0], handler[1], stored);
    connection.ssh = ssh;
    connection.sshIssue = issue;
  }
  return connection;
}

export async function parseDbeaverConfig(
  dataSources: string,
  credentialsFile: Uint8Array | null = null,
): Promise<ExternalParseResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(dataSources);
  } catch {
    return { connections: [], error: "data-sources.json ist kein gültiges JSON.", notice: null };
  }
  if (!isRecord(parsed) || !isRecord(parsed.connections))
    return {
      connections: [],
      error: "Die Datei ist keine DBeaver-Konfiguration (data-sources.json).",
      notice: null,
    };
  let credentials: Json = {};
  let notice: string | null = null;
  if (credentialsFile && credentialsFile.length > 0) {
    const decrypted = await decryptDbeaverCredentials(credentialsFile);
    if (decrypted) credentials = decrypted;
    else
      notice =
        "credentials-config.json ließ sich nicht entschlüsseln (eigenes Master-Passwort?). Passwörter werden nicht übernommen.";
  } else {
    notice = "Keine credentials-config.json gefunden. Passwörter werden nicht übernommen.";
  }
  const connections = Object.entries(parsed.connections)
    .filter((entry): entry is [string, Json] => isRecord(entry[1]))
    .map(([id, raw]) => parseEntry(id, raw, credentials));
  return { connections, error: null, notice };
}
