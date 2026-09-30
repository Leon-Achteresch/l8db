import { type SavedConnection, useConnectionsStore } from "@/lib/connections";

export function supabaseReferenceOf(connection: SavedConnection): string | null {
  if (connection.kind !== "postgres") return null;
  try {
    const url = new URL(connection.connectionString);
    const direct = /^db\.([a-z0-9]{20})\.supabase\.co$/.exec(url.hostname);
    if (direct) return direct[1];
    if (!url.hostname.endsWith(".pooler.supabase.com")) return null;
    const pooled = /^postgres\.([a-z0-9]{20})$/.exec(decodeURIComponent(url.username));
    return pooled ? pooled[1] : null;
  } catch {
    return null;
  }
}

export function useSupabaseDatabase(reference: string): SavedConnection | undefined {
  return useConnectionsStore((state) =>
    state.connections.find((connection) => supabaseReferenceOf(connection) === reference),
  );
}
