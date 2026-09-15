import { sslModeFromUrl } from "@/lib/connection-url";
import type { DatabaseKind, SslMode } from "@/lib/db";

export function defaultSslModeForProvider(
  kind: DatabaseKind | undefined,
  providerId: string | undefined,
  fallback: SslMode,
): SslMode {
  if (providerId === "azure-sql") return "require";
  if (kind === "mssql") return "disable";
  return fallback;
}

export function initialSslMode(
  url: string,
  fallback: SslMode,
  saved?: SslMode,
  kind?: DatabaseKind,
  providerId?: string,
): SslMode {
  if (saved) return saved;
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("sslmode") || parsed.searchParams.has("encrypt"))
      return sslModeFromUrl(url);
  } catch {
    return defaultSslModeForProvider(kind, providerId, fallback);
  }
  return defaultSslModeForProvider(kind, providerId, fallback);
}
