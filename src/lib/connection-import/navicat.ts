import type { SshAuth } from "@/lib/connections";
import type { SslMode } from "@/lib/db";
import { decryptNavicatPassword } from "./crypto";
import { parsePort } from "./jdbc";
import {
  FILE_KINDS,
  isUnsupportedProduct,
  matchProduct,
  type ProductMatch,
  resolveProduct,
} from "./products";
import { type ExternalParseResult, emptyExternalConnection } from "./types";
import { attribute, findElements, parseXml, type XmlElement } from "./xml";

export type LegacyDecryptor = (values: string[]) => Promise<Array<string | null>>;

const LEGACY_HINT = "Navicat-11-Passwort konnte nicht entschlüsselt werden.";

function truthy(value: string): boolean {
  return ["true", "1", "yes", "on"].includes(value.trim().toLowerCase());
}

function sshAuthOf(value: string, keyFile: string): SshAuth {
  const normalized = value.toUpperCase();
  if (normalized.includes("AGENT")) return "agent";
  if (normalized.includes("PUBLICKEY") || normalized.includes("KEY")) return "key";
  if (normalized.includes("PASSWORD")) return "password";
  return keyFile ? "key" : "password";
}

function productOf(connType: string, serviceProvider: string): ProductMatch | null {
  const base = resolveProduct([connType]);
  if (!base || !serviceProvider || serviceProvider === "Default") return base;
  if (isUnsupportedProduct(serviceProvider)) return null;
  const refined = matchProduct(serviceProvider);
  if (!refined) return base;
  if (refined.kind !== base.kind) return /oceanbase/i.test(serviceProvider) ? null : base;
  return refined;
}

const PG_SSL_MODES: Record<string, SslMode> = {
  disable: "disable",
  allow: "prefer",
  prefer: "prefer",
  require: "require",
  "verify-ca": "verify-ca",
  "verify-full": "verify-full",
};

function navicatSslMode(element: XmlElement): SslMode {
  const pg = PG_SSL_MODES[attribute(element, "SSL_PGSSLMode").toLowerCase().replace(/_/g, "-")];
  if (pg) return pg;
  const verify = attribute(element, "SSL_VerifyServerCert", "SSL_VerifyCA", "SSL_VerifyCert");
  return verify && !truthy(verify) ? "require" : "verify-full";
}

interface PendingSecret {
  cipher: string;
  apply: (value: string | null) => void;
}

function readConnection(element: XmlElement, index: number, pending: PendingSecret[]) {
  const name = attribute(element, "ConnectionName", "Name") || `Navicat ${index + 1}`;
  const connection = emptyExternalConnection(`navicat-${index}`, name);
  const connType = attribute(element, "ConnType", "DatabaseType", "Type");
  const serviceProvider = attribute(element, "ServiceProvider");
  connection.driver = [
    connType,
    serviceProvider && serviceProvider !== "Default" ? serviceProvider : "",
  ]
    .filter(Boolean)
    .join(" / ");
  const product = productOf(connType, serviceProvider);
  connection.kind = product?.kind ?? null;
  connection.product = product?.label ?? connType;
  connection.user = attribute(element, "UserName", "User");
  const savePassword = attribute(element, "SavePassword");
  const cipher = attribute(element, "Password");
  if (cipher)
    pending.push({
      cipher,
      apply: (value) => {
        connection.password = value;
        if (!value) connection.passwordHint = LEGACY_HINT;
      },
    });
  else if (savePassword && !truthy(savePassword))
    connection.passwordHint = "Passwort war in Navicat nicht gespeichert.";
  if (connection.kind && FILE_KINDS.includes(connection.kind)) {
    connection.database = attribute(element, "DatabaseFileName", "DatabaseFile", "Database");
    return connection;
  }
  connection.host = attribute(element, "Host", "Server");
  connection.port = parsePort(attribute(element, "Port"));
  const oracle = connection.kind === "oracle";
  connection.database = attribute(element, "Database", "InitialDatabase", "ServiceName", "SID");
  if (oracle) {
    const mode = attribute(element, "OraConnType").toUpperCase();
    const tns = attribute(element, "TNS");
    if (mode === "TNS" && tns) {
      connection.oracleDescriptor = tns;
      connection.host ||= /^[A-Za-z0-9._-]+$/.test(tns) ? tns : "tns";
    }
    connection.oracleSid = attribute(element, "OraServiceNameType").toUpperCase() === "SID";
  }
  if (connection.kind === "mssql") {
    const instance = connection.host.indexOf("\\");
    if (instance >= 0) {
      const name = connection.host.slice(instance + 1).trim();
      connection.host = connection.host.slice(0, instance).trim();
      if (name) connection.params.push(["instance", name]);
    }
  }
  if (truthy(attribute(element, "SSL"))) connection.sslMode = navicatSslMode(element);
  if (truthy(attribute(element, "HTTP"))) {
    connection.sshIssue =
      "Navicat-HTTP-Tunnel (ntunnel-Skript) wird nicht unterstützt. Bitte SSH oder einen Proxy einrichten.";
    return connection;
  }
  if (truthy(attribute(element, "SSH"))) {
    const host = attribute(element, "SSH_Host");
    if (!host) {
      connection.sshIssue = "SSH-Tunnel ist aktiv, aber der SSH-Host fehlt in der Konfiguration.";
      return connection;
    }
    const keyFile = attribute(element, "SSH_PrivateKey");
    const auth = sshAuthOf(attribute(element, "SSH_AuthenMethod"), keyFile);
    const ssh = {
      host,
      port: parsePort(attribute(element, "SSH_Port")) ?? 22,
      user: attribute(element, "SSH_UserName"),
      auth,
      keyFile: auth === "key" ? keyFile : "",
      secret: null as string | null,
    };
    connection.ssh = ssh;
    const sshCipher =
      auth === "key" ? attribute(element, "SSH_Passphrase") : attribute(element, "SSH_Password");
    if (sshCipher && auth !== "agent")
      pending.push({
        cipher: sshCipher,
        apply: (value) => {
          ssh.secret = value;
        },
      });
  }
  return connection;
}

async function resolveSecrets(pending: PendingSecret[], legacy?: LegacyDecryptor) {
  const modern = await Promise.all(pending.map((entry) => decryptNavicatPassword(entry.cipher)));
  const fallback: PendingSecret[] = [];
  pending.forEach((entry, index) => {
    const value = modern[index];
    if (value !== null) entry.apply(value);
    else fallback.push(entry);
  });
  if (!fallback.length) return;
  let decrypted: Array<string | null> = [];
  if (legacy) {
    try {
      decrypted = await legacy(fallback.map((entry) => entry.cipher));
    } catch {
      decrypted = [];
    }
  }
  for (const [index, entry] of fallback.entries()) entry.apply(decrypted[index] ?? null);
}

export async function parseNavicatExport(
  text: string,
  legacy?: LegacyDecryptor,
): Promise<ExternalParseResult> {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (caught) {
    return {
      connections: [],
      error: caught instanceof Error ? caught.message : String(caught),
      notice: null,
    };
  }
  const elements = findElements(root, "Connection");
  if (!elements.length)
    return {
      connections: [],
      error: "Die Datei ist kein Navicat-Verbindungsexport (.ncx).",
      notice: null,
    };
  const pending: PendingSecret[] = [];
  const connections = elements.map((element, index) => readConnection(element, index, pending));
  await resolveSecrets(pending, legacy);
  return { connections, error: null, notice: null };
}
