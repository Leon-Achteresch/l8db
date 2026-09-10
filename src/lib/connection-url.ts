import type { DatabaseKind, ProviderInfo, SslMode } from "@/lib/db";
import { allProviders, FALLBACK_PROVIDERS, providerById, providerForKind } from "@/lib/providers";

const SSL_MODES = ["disable", "prefer", "require", "verify-ca", "verify-full"];
const PATH_LIKE = /^(\/|~\/|\.{1,2}\/|[A-Za-z]:[\\/]|:memory:$)/;
const USER_REQUIRED: DatabaseKind[] = ["postgres", "mysql", "mssql", "oracle"];
const DATABASE_REQUIRED: DatabaseKind[] = ["postgres", "oracle"];
const SSLMODE_PARAM: DatabaseKind[] = ["postgres", "mysql", "mssql"];

export function kindFromUrl(value: string): DatabaseKind | undefined {
  const trimmed = value.trim();
  if (PATH_LIKE.test(trimmed)) return /\.(duckdb|ddb)$/i.test(trimmed) ? "duckdb" : "sqlite";
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

export function parseConnectionUrl(value: string, kind = kindFromUrl(value)): URL {
  if (!kind) throw new Error("Gib eine gültige Verbindungs-URL ein, z. B. postgresql://…");
  const info = providerForKind(kind);
  if (info?.file_based) return parseFileUrl(value, kind);
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Gib eine gültige Verbindungs-URL ein.");
  }
  const schemes = info?.url_schemes ?? [kind];
  if (!schemes.includes(url.protocol.slice(0, -1).toLowerCase()))
    throw new Error(
      `Die URL muss mit ${schemes.map((scheme) => `${scheme}://`).join(" oder ")} beginnen.`,
    );
  if (!url.hostname) throw new Error("Der Host fehlt in der URL.");
  if (USER_REQUIRED.includes(kind) && !url.username)
    throw new Error("Der Benutzer fehlt in der URL.");
  if (DATABASE_REQUIRED.includes(kind) && (!url.pathname || url.pathname === "/"))
    throw new Error(
      kind === "oracle"
        ? "Der Service-Name fehlt in der URL."
        : "Der Datenbankname fehlt in der URL.",
    );
  if (kind === "postgres") {
    for (const key of ["host", "hostaddr", "port", "user", "password", "dbname"]) {
      if (url.searchParams.has(key))
        throw new Error(
          `Setze ${key} direkt in der URL oder über die einzelnen Felder, nicht als URL-Parameter.`,
        );
    }
  }
  if (SSLMODE_PARAM.includes(kind)) {
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
    const mode = new URL(value.trim()).searchParams.get("sslmode");
    if (mode && SSL_MODES.includes(mode)) return mode as SslMode;
  } catch {
    return "prefer";
  }
  return "prefer";
}

export function detectProvider(value: string, kind = kindFromUrl(value)): string {
  const candidates = allProviders().filter((provider) => provider.kind === (kind ?? "postgres"));
  if (!candidates.length) return "postgres";
  let host = "";
  try {
    host = new URL(value.trim()).hostname.toLowerCase();
  } catch {
    host = "";
  }
  const match = candidates.find((provider) =>
    provider.hosts.some((entry) => (entry.startsWith(".") ? host.endsWith(entry) : host === entry)),
  );
  const cloud = host ? candidates.find((provider) => provider.id === "cloud-postgres") : undefined;
  return (match ?? cloud ?? candidates[0]).id;
}

export function providerFor(connection: {
  kind: DatabaseKind;
  connectionString: string;
}): ProviderInfo {
  return (
    providerById(detectProvider(connection.connectionString, connection.kind)) ??
    providerForKind(connection.kind) ??
    FALLBACK_PROVIDERS[0]
  );
}

export function connectionSummary(value: string, kind = kindFromUrl(value)) {
  const info = kind ? providerForKind(kind) : undefined;
  if (info?.file_based) {
    const path = filePath(value);
    return { host: path.split("/").pop() || path, port: "", database: path, user: "" };
  }
  try {
    const url = new URL(value.trim());
    return {
      host: url.hostname,
      port: url.port || String(info?.default_port ?? ""),
      database: decodeURIComponent(url.pathname.slice(1)),
      user: decodeURIComponent(url.username),
    };
  } catch {
    return { host: "Ungültiger Endpunkt", port: "", database: "", user: "" };
  }
}

export function connectionError(error: unknown): string {
  const message = String(error).replace(/[a-z][a-z0-9+.-]*:\/\/[^\s]+/gi, "[Verbindungs-URL]");
  if (/__TAURI|invoke|undefined.*(properties|function)/i.test(message))
    return "Zum Testen und Verbinden öffne l8db als Desktop-App.";
  if (
    /password authentication|28P01|Access denied|Login failed|Authentication failed|NOAUTH|WRONGPASS|ORA-01017/i.test(
      message,
    )
  )
    return "Anmeldung fehlgeschlagen. Prüfe Benutzer und Datenbankpasswort.";
  if (/certificate|tls|ssl/i.test(message))
    return "TLS-Verbindung fehlgeschlagen. Prüfe SSL-Modus, Servername und das Zertifikat im System-Zertifikatsspeicher.";
  if (/timeout|timed out/i.test(message))
    return "Der Server antwortet nicht rechtzeitig. Prüfe Endpunkt, Firewall und ob die Datenbank läuft.";
  if (/refused|resolve|dns|No such host/i.test(message))
    return "Der Server ist nicht erreichbar. Prüfe Host, Port und Netzwerkzugang.";
  return message.replace(/^Error:\s*/, "");
}
