import { sslModeFromUrl } from "@/lib/connection-url";
import type { SslMode } from "@/lib/db";

export function initialSslMode(url: string, fallback: SslMode, saved?: SslMode): SslMode {
  if (saved) return saved;
  try {
    const parsed = new URL(url);
    if (parsed.searchParams.has("sslmode")) return sslModeFromUrl(url);
  } catch {
    return fallback;
  }
  return fallback;
}
