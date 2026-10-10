import type { SshAuth } from "@/lib/connections";
import { expandHomeMacro, parseJdbcUrl, parsePort } from "./jdbc";
import { FILE_KINDS, resolveProduct } from "./products";
import {
  type ExternalConnection,
  type ExternalParseResult,
  type ExternalSsh,
  emptyExternalConnection,
} from "./types";
import { attribute, childElement, childText, findElements, parseXml, type XmlElement } from "./xml";

export interface DataGripFile {
  name: string;
  text: string;
}

export const DATAGRIP_PASSWORD_HINT =
  "DataGrip speichert Passwörter im JetBrains-Schlüsselbund. Bitte nach dem Import neu eingeben.";

export const DATAGRIP_MISSING_SSH =
  "SSH-Konfiguration nicht gefunden. Bitte sshConfigs.xml aus dem IDE-Ordner options hinzufügen.";

export function needsDataGripSshConfigs(result: ExternalParseResult): boolean {
  return result.connections.some((connection) => connection.sshIssue === DATAGRIP_MISSING_SSH);
}

interface Fragment {
  uuid: string;
  name: string;
  group: string;
  driverRef: string;
  driverClass: string;
  url: string;
  user: string;
  product: string;
  readOnly: boolean;
  ssh: XmlElement | null;
}

function emptyFragment(uuid: string): Fragment {
  return {
    uuid,
    name: "",
    group: "",
    driverRef: "",
    driverClass: "",
    url: "",
    user: "",
    product: "",
    readOnly: false,
    ssh: null,
  };
}

function userOf(element: XmlElement): string {
  return (
    childText(element, "user-name") ||
    childText(element, "username") ||
    childText(element, "user") ||
    attribute(element, "user-name", "username", "user")
  );
}

function sshAuthOf(value: string, keyFile: string): SshAuth {
  const normalized = value.toUpperCase();
  if (normalized.includes("OPEN_SSH") || normalized.includes("AGENT")) return "agent";
  if (normalized.includes("KEY")) return "key";
  if (normalized.includes("PASSWORD")) return "password";
  return keyFile ? "key" : "password";
}

function collectSshConfigs(root: XmlElement, into: Map<string, XmlElement>) {
  for (const config of findElements(root, "sshConfig")) {
    const id = attribute(config, "id");
    if (id && !into.has(id)) into.set(id, config);
  }
}

function sshEnabled(element: XmlElement): boolean {
  const enabled = childText(element, "enabled") || attribute(element, "enabled");
  return enabled.toLowerCase() === "true";
}

function resolveSsh(
  properties: XmlElement,
  configs: Map<string, XmlElement>,
): { ssh: ExternalSsh | null; issue: string | null } {
  const configId = childText(properties, "ssh-config-id") || attribute(properties, "ssh-config-id");
  const config = configId ? configs.get(configId) : undefined;
  if (configId && !config)
    return {
      ssh: null,
      issue: DATAGRIP_MISSING_SSH,
    };
  const host = config
    ? attribute(config, "host")
    : childText(properties, "proxy-host") || childText(properties, "host");
  if (!host)
    return {
      ssh: null,
      issue: "SSH-Tunnel ist aktiv, aber der SSH-Host fehlt in der Konfiguration.",
    };
  const keyFile = expandHomeMacro(
    config
      ? attribute(config, "keyPath", "keyFile")
      : childText(properties, "key-file") || childText(properties, "key-path"),
  );
  const auth = sshAuthOf(
    config ? attribute(config, "authType") : childText(properties, "auth-type"),
    keyFile,
  );
  return {
    ssh: {
      host,
      port: parsePort(config ? attribute(config, "port") : childText(properties, "port")) ?? 22,
      user: config
        ? attribute(config, "username", "user")
        : childText(properties, "user") || childText(properties, "user-name"),
      auth,
      keyFile: auth === "key" ? keyFile : "",
      secret: null,
    },
    issue: null,
  };
}

function absorb(fragment: Fragment, element: XmlElement) {
  fragment.name ||= attribute(element, "name");
  fragment.group ||= attribute(element, "group", "group-name");
  fragment.driverRef ||= childText(element, "driver-ref");
  fragment.driverClass ||= childText(element, "jdbc-driver");
  fragment.url ||= childText(element, "jdbc-url");
  fragment.user = userOf(element) || fragment.user;
  fragment.product ||= attribute(childElement(element, "database-info") ?? element, "product");
  if (childText(element, "read-only").toLowerCase() === "true") fragment.readOnly = true;
  const ssh = childElement(element, "ssh-properties");
  if (ssh && sshEnabled(ssh)) fragment.ssh = ssh;
}

function toConnection(fragment: Fragment, configs: Map<string, XmlElement>): ExternalConnection {
  const connection = emptyExternalConnection(fragment.uuid, fragment.name || fragment.uuid);
  const target = fragment.url ? parseJdbcUrl(fragment.url) : null;
  connection.folder = fragment.group.replace(/\s*\/\s*/g, "/");
  connection.driver = fragment.driverRef || target?.subprotocol || fragment.driverClass;
  const product = resolveProduct([
    fragment.driverRef,
    target?.subprotocol ?? "",
    fragment.product,
    fragment.driverClass,
  ]);
  connection.kind = product?.kind ?? null;
  connection.product = product?.label ?? fragment.product;
  connection.readOnly = fragment.readOnly;
  if (!connection.kind) return connection;
  if (!fragment.url) {
    connection.issue = "JDBC-URL fehlt.";
    return connection;
  }
  if (!target) {
    connection.issue = "JDBC-URL konnte nicht gelesen werden.";
    return connection;
  }
  connection.user = fragment.user || target.user;
  connection.password = target.password || null;
  connection.passwordHint = DATAGRIP_PASSWORD_HINT;
  if (connection.kind && FILE_KINDS.includes(connection.kind)) {
    connection.database = target.path;
    return connection;
  }
  connection.host = target.host;
  connection.port = target.port;
  connection.database = target.database;
  connection.params = target.params;
  connection.oracleSid = target.oracleSid;
  connection.oracleDescriptor = target.oracleDescriptor;
  connection.srv = target.srv;
  if (fragment.ssh) {
    const { ssh, issue } = resolveSsh(fragment.ssh, configs);
    connection.ssh = ssh;
    connection.sshIssue = issue;
  }
  return connection;
}

export function parseDataGripConfig(files: DataGripFile[]): ExternalParseResult {
  const fragments = new Map<string, Fragment>();
  const configs = new Map<string, XmlElement>();
  const broken: string[] = [];
  let sawDataSources = false;
  for (const file of files) {
    let root: XmlElement;
    try {
      root = parseXml(file.text);
    } catch {
      broken.push(file.name);
      continue;
    }
    collectSshConfigs(root, configs);
    for (const element of findElements(root, "data-source")) {
      sawDataSources = true;
      const uuid = attribute(element, "uuid") || attribute(element, "name");
      if (!uuid) continue;
      const fragment = fragments.get(uuid) ?? emptyFragment(uuid);
      absorb(fragment, element);
      fragments.set(uuid, fragment);
    }
  }
  if (!sawDataSources)
    return {
      connections: [],
      error: broken.length
        ? `Ungültiges XML in ${broken.join(", ")}.`
        : "Keine DataGrip-Datenquellen gefunden. Bitte dataSources.xml auswählen.",
      notice: null,
    };
  const connections = [...fragments.values()].map((fragment) => toConnection(fragment, configs));
  const notices = [DATAGRIP_PASSWORD_HINT];
  if (broken.length) notices.push(`Übersprungen (ungültiges XML): ${broken.join(", ")}.`);
  return { connections, error: null, notice: notices.join(" ") };
}
