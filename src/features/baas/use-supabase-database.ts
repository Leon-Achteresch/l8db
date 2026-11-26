import { type SavedConnection, useConnectionsStore } from "@/lib/connections";

export function supabaseReferenceFromUrl(url: URL): string | null {
  const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
  if (direct) return direct[1];
  if (!url.hostname.endsWith(".pooler.supabase.com")) return null;
  try {
    const pooled = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(url.username));
    return pooled ? pooled[1] : null;
  } catch {
    return null;
  }
}

export function supabaseReferenceOf(connection: SavedConnection): string | null {
  if (connection.kind !== "postgres") return null;
  try {
    return supabaseReferenceFromUrl(new URL(connection.connectionString));
  } catch {
    return null;
  }
}

export function isSelfHostedSupabaseDatabase(
  connection: SavedConnection,
  apiUrl: string,
  name: string,
): boolean {
  if (connection.kind !== "postgres" || connection.name !== name) return false;
  try {
    const host = new URL(connection.connectionString).hostname;
    const apiHost = new URL(apiUrl).hostname;
    return host === apiHost || host === `db.${apiHost}`;
  } catch {
    return false;
  }
}

export function useSupabaseDatabase(
  reference: string,
  selfHosted?: { url: string; name: string },
): SavedConnection | undefined {
  return useConnectionsStore((state) =>
    state.connections.find((connection) =>
      selfHosted
        ? isSelfHostedSupabaseDatabase(connection, selfHosted.url, selfHosted.name)
        : supabaseReferenceOf(connection) === reference,
    ),
  );
}
