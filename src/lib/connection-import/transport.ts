import type { DatabaseKind, SslMode } from "@/lib/db";
import { ADAPTERS, type AdapterFacts } from "./adapters";

export interface TransportSource {
  params: Array<[string, string]>;
  sslMode: SslMode | null;
  urlScheme: "http" | "https" | null;
  portFromUrl: boolean;
  port: number | null;
}

export interface ResolvedTransport {
  scheme: string;
  port: number | null;
  sshRemotePort: number;
  params: Array<[string, string]>;
  sslMode: SslMode;
  tls: boolean | null;
  stripped: string[];
  warnings: string[];
}

const SECURE_MODES: SslMode[] = ["require", "verify-ca", "verify-full"];

const SECRET_LIKE =
  /pass(word|phrase)?|pwd|secret|token|credential|api[_-]?key|private[_-]?key|access[_-]?key/i;

const MODE_KEYS = ["sslmode", "ssl-mode", "ssl_mode"];

const FLAG_KEYS = ["ssl", "tls", "secure", "usessl", "requiressl", "encrypt"];

const INSECURE_KEYS = [
  "insecure",
  "tls_insecure",
  "skip_verify",
  "sslinsecure",
  "trustallcertificates",
  "tlsallowinvalidcertificates",
  "tlsinsecure",
  "trustservercertificate",
  "trust_server_certificate",
];

const VERIFY_KEYS = [
  "verify",
  "ssl_verify",
  "sslverify",
  "verify_ssl",
  "verifyservercertificate",
  "verify_server_certificate",
  "sslverification",
  "ssl.verify.server",
];

const FACTORY_KEYS = ["sslfactory"];

const TLS_KEYS = new Set([
  ...MODE_KEYS,
  ...FLAG_KEYS,
  ...INSECURE_KEYS,
  ...VERIFY_KEYS,
  ...FACTORY_KEYS,
]);

const RENAMES: Partial<Record<DatabaseKind, Record<string, string>>> = {
  mssql: {
    instancename: "instance",
    instance: "instance",
    integratedsecurity: "integrated_security",
    integrated_security: "integrated_security",
    applicationname: "application_name",
  },
};

const MODE_VALUES: Record<string, SslMode> = {
  disable: "disable",
  disabled: "disable",
  allow: "prefer",
  prefer: "prefer",
  preferred: "prefer",
  optional: "prefer",
  require: "require",
  required: "require",
  "verify-ca": "verify-ca",
  verify_ca: "verify-ca",
  "verify-full": "verify-full",
  verify_full: "verify-full",
  verify_identity: "verify-full",
  "verify-identity": "verify-full",
};

function flag(value: string): boolean | null {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on", "mandatory", "strict"].includes(normalized)) return true;
  if (["false", "0", "no", "off", "disable", "disabled"].includes(normalized)) return false;
  return null;
}

export function sslModeOf(value: string): SslMode | null {
  return MODE_VALUES[value.trim().toLowerCase()] ?? null;
}

interface Signals {
  mode: SslMode | null;
  tls: boolean | null;
  verifyOff: boolean;
  verifyOn: boolean;
}

function decisive(mode: SslMode | null): mode is SslMode {
  return mode !== null && mode !== "prefer";
}

function readSignals(facts: AdapterFacts, source: TransportSource): Signals {
  let paramMode: SslMode | null = null;
  let verifyOff = false;
  let verifyOn = false;
  const flags = new Map<string, boolean>();
  for (const [rawKey, value] of source.params) {
    const key = rawKey.trim().toLowerCase();
    if (MODE_KEYS.includes(key)) paramMode = sslModeOf(value) ?? paramMode;
    else if (FLAG_KEYS.includes(key)) {
      const on = flag(value);
      if (on !== null && !(key === "encrypt" && value.trim().toLowerCase() === "optional"))
        flags.set(key, on);
    } else if (INSECURE_KEYS.includes(key) && flag(value) === true) verifyOff = true;
    else if (VERIFY_KEYS.includes(key)) {
      const on = flag(value);
      if (on === false) verifyOff = true;
      if (on === true) verifyOn = true;
    } else if (FACTORY_KEYS.includes(key) && /NonValidatingFactory/i.test(value)) verifyOff = true;
  }
  const decidingKey = facts.flagKeys.find((key) => flags.has(key));
  const flagged = decidingKey
    ? (flags.get(decidingKey) as boolean)
    : source.urlScheme === "https"
      ? true
      : source.urlScheme === "http"
        ? false
        : null;
  const mode = decisive(paramMode)
    ? paramMode
    : decisive(source.sslMode)
      ? source.sslMode
      : flagged === true
        ? verifyOn && facts.flagMode === "require"
          ? "verify-ca"
          : facts.flagMode
        : flagged === false
          ? "disable"
          : null;
  if (mode === "require") verifyOff = true;
  return { mode, tls: mode === null ? null : SECURE_MODES.includes(mode), verifyOff, verifyOn };
}

function finalMode(signals: Signals): SslMode {
  if (signals.tls === null) return "prefer";
  if (!signals.tls) return "disable";
  if (signals.verifyOff) return "require";
  return signals.mode === "verify-ca" ? "verify-ca" : "verify-full";
}

function writeTls(
  kind: DatabaseKind,
  facts: AdapterFacts,
  signals: Signals,
  sslMode: SslMode,
  params: Array<[string, string]>,
  warnings: string[],
) {
  const tls = signals.tls;
  if (facts.tlsWriter === "sslmode") params.push(["sslmode", sslMode]);
  else if (facts.tlsWriter === "secure" && tls !== null) params.push(["secure", tls ? "1" : "0"]);
  else if (facts.tlsWriter === "ssl" && tls !== null) params.push(["ssl", String(tls)]);
  else if (facts.tlsWriter === "mongo" && tls !== null) params.push(["tls", String(tls)]);
  if (!tls) return;
  if (facts.tlsWriter === "none") {
    warnings.push(`TLS aus der Quelle wird für ${facts.scheme} beim Import nicht übernommen.`);
    return;
  }
  if (!signals.verifyOff || facts.tlsWriter === "sslmode") return;
  if (facts.insecureParam) {
    params.push(facts.insecureParam);
    warnings.push("Zertifikatsprüfung ist aus, wie in der Quelle eingestellt.");
  } else {
    warnings.push(`Zertifikatsprüfung war in der Quelle aus, l8db prüft das Zertifikat (${kind}).`);
  }
}

export function implicitPort(kind: DatabaseKind, tls: boolean): number | null {
  const facts = ADAPTERS[kind];
  if (!facts) return null;
  return tls ? facts.implicitTlsPort : facts.fieldPort;
}

export function resolveTransport(
  kind: DatabaseKind,
  source: TransportSource,
): ResolvedTransport | null {
  const facts = ADAPTERS[kind];
  if (!facts) return null;
  const signals = readSignals(facts, source);
  const sslMode = finalMode(signals);
  const renames = RENAMES[kind] ?? {};
  const params: Array<[string, string]> = [];
  const stripped: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const [rawKey, value] of source.params) {
    const key = rawKey.trim();
    const lower = key.toLowerCase();
    if (SECRET_LIKE.test(key) && !TLS_KEYS.has(lower)) {
      stripped.push(key);
      continue;
    }
    if (TLS_KEYS.has(lower)) continue;
    const name = renames[lower] ?? key;
    if (seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    params.push([name, value]);
  }
  writeTls(kind, facts, signals, sslMode, params, warnings);
  const tls = signals.tls === true;
  const port =
    source.port ??
    (source.urlScheme === "https" && source.portFromUrl
      ? facts.httpsUrlPort
      : tls
        ? facts.fieldTlsPort
        : facts.fieldPort);
  return {
    scheme: facts.tlsWriter === "scheme" && tls ? facts.tlsScheme : facts.scheme,
    port,
    sshRemotePort: port ?? implicitPort(kind, tls) ?? 0,
    params,
    sslMode,
    tls: signals.tls,
    stripped,
    warnings,
  };
}
