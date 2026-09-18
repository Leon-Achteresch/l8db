import type { DatabaseKind, SslMode } from "@/lib/db";
import { allProviders, providerForKind } from "@/lib/providers";
import { DATABASE_REQUIRED, PATH_LIKE, SSL_MODES, SSLMODE_PARAM, USER_REQUIRED } from "./constants";
import { oracleConnectString, oracleKeyValueToUrl } from "./oracle-endpoint";
import { isOracleKeyValue } from "./oracle-key-value";

export function kindFromUrl(value: string): DatabaseKind | undefined {
  const trimmed = value.trim();
  if (PATH_LIKE.test(trimmed)) return /\.(duckdb|ddb)$/i.test(trimmed) ? "duckdb" : "sqlite";
  if (isOracleKeyValue(trimmed)) return "oracle";
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(trimmed);
  if (!match) return undefined;
  const scheme = match[1].toLowerCase();
  return allProviders().find((provider) => provider.url_schemes.includes(scheme))?.kind;
}

export function filePath(value: string): string {
  const stripped = value.trim().replace(/^(sqlite|duckdb|file):(\/\/)?/i, "");
  try {
    return decodeURIComponent(stripped);
  } catch {
    return stripped;
  }
}

function parseFileUrl(value: string, kind: DatabaseKind): URL {
  const path = filePath(value).replace(/\\/g, "/");
  if (!path) throw new Error("Gib den Pfad zur Datenbankdatei an.");
  if (path !== ":memory:" && !PATH_LIKE.test(path))
    throw new Error("Gib einen absoluten Pfad zur Datenbankdatei an.");
  return new URL(`${kind}:${path}`);
}

const TRUSTED_KEYS = [
  "trusted_connection",
  "trustedconnection",
  "integrated_security",
  "integratedsecurity",
];

const TRUSTED_VALUES = ["true", "yes", "1", "sspi"];

export function isTrustedConnection(url: URL): boolean {
  return TRUSTED_KEYS.some((key) =>
    TRUSTED_VALUES.includes((url.searchParams.get(key) ?? "").toLowerCase()),
  );
}

export function parseConnectionUrl(value: string, kind = kindFromUrl(value)): URL {
  let text = value.trim();
  let resolved = kind;
  if (!/:\/\//.test(text) && text.includes("=")) {
    if (resolved === undefined && isOracleKeyValue(text)) resolved = "oracle";
    if (resolved === "oracle") text = oracleKeyValueToUrl(text);
  }
  if (!resolved) throw new Error("Gib eine gültige Verbindungs-URL ein, z. B. postgresql://…");
  const info = providerForKind(resolved);
  if (info?.file_based) return parseFileUrl(text, resolved);
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw new Error("Gib eine gültige Verbindungs-URL ein.");
  }
  const override = resolved === "oracle" ? oracleConnectString(url) : null;
  const schemes = info?.url_schemes ?? [resolved];
  if (!schemes.includes(url.protocol.slice(0, -1).toLowerCase()))
    throw new Error(
      `Die URL muss mit ${schemes.map((scheme) => `${scheme}://`).join(" oder ")} beginnen.`,
    );
  if (!url.hostname) throw new Error("Der Host fehlt in der URL.");
  if (USER_REQUIRED.includes(resolved) && !url.username && !isTrustedConnection(url))
    throw new Error("Der Benutzer fehlt in der URL.");
  if (DATABASE_REQUIRED.includes(resolved) && (!url.pathname || url.pathname === "/") && !override)
    throw new Error(
      resolved === "oracle"
        ? "Der Service-Name fehlt in der URL."
        : "Der Datenbankname fehlt in der URL.",
    );
  if (resolved === "postgres") {
    for (const key of ["host", "hostaddr", "port", "user", "password", "dbname"]) {
      if (url.searchParams.has(key))
        throw new Error(
          `Setze ${key} direkt in der URL oder über die einzelnen Felder, nicht als URL-Parameter.`,
        );
    }
  }
  if (SSLMODE_PARAM.includes(resolved)) {
    const ssl = url.searchParams.get("sslmode");
    if (ssl && !SSL_MODES.includes(ssl))
      throw new Error("Der SSL-Modus in der URL wird nicht unterstützt.");
  }
  if (url.hash)
    throw new Error(
      "Sonderzeichen im Passwort müssen URL-kodiert sein. Nutze dafür die einzelnen Felder.",
    );
  if (
    url.port &&
    (!Number.isInteger(Number(url.port)) || Number(url.port) < 1 || Number(url.port) > 65535)
  )
    throw new Error("Der Port muss zwischen 1 und 65535 liegen.");
  for (const part of [url.username, url.password, url.pathname]) {
    try {
      decodeURIComponent(part);
    } catch {
      throw new Error("Die URL enthält eine ungültige Zeichenkodierung.");
    }
  }
  return url;
}

export function sslModeFromUrl(value: string): SslMode {
  try {
    const params = new URL(value.trim()).searchParams;
    const mode = params.get("sslmode");
    if (mode && SSL_MODES.includes(mode)) return mode as SslMode;
    const encrypt = params.get("encrypt")?.toLowerCase();
    if (encrypt) {
      if (["false", "no", "0", "disable", "disabled", "optional"].includes(encrypt))
        return "disable";
      return "require";
    }
  } catch {
    return "prefer";
  }
  return "prefer";
}
