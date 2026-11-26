import { type DehydratedState, dehydrate, hydrate, type QueryClient } from "@tanstack/react-query";
import { useConnectionsStore } from "@/lib/connections/store";

export const SNAPSHOT_KEY = "l8db.snapshot";
export const SNAPSHOT_MAX_BYTES = 4_000_000;

const ROOTS = new Set([
  "databases",
  "schemas",
  "tables",
  "views",
  "matviews",
  "functions",
  "procedures",
  "package-members",
  "sequences",
  "synonyms",
  "extensions",
  "schema-map",
  "overview",
  "all-tables",
  "all-views",
  "all-matviews",
  "all-columns",
  "all-objects",
]);

type Snapshot = { connectionId: string; queries: DehydratedState["queries"] };

function activeConnectionId() {
  const { connections, activeId } = useConnectionsStore.getState();
  return connections.find((entry) => entry.id === activeId && !entry.temporary)?.id;
}

export function restoreConnectionSnapshot(client: QueryClient, storage: Storage = localStorage) {
  const raw = storage.getItem(SNAPSHOT_KEY);
  if (!raw) return 0;
  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(raw);
  } catch {
    storage.removeItem(SNAPSHOT_KEY);
    return 0;
  }
  const { connections } = useConnectionsStore.getState();
  if (!connections.some((entry) => entry.id === snapshot.connectionId)) {
    storage.removeItem(SNAPSHOT_KEY);
    return 0;
  }
  if (snapshot.connectionId !== activeConnectionId() || !Array.isArray(snapshot.queries)) return 0;
  hydrate(client, { mutations: [], queries: snapshot.queries });
  return snapshot.queries.length;
}

export function saveConnectionSnapshot(
  client: QueryClient,
  storage: Storage = localStorage,
  maxBytes = SNAPSHOT_MAX_BYTES,
) {
  const connectionId = activeConnectionId();
  if (!connectionId) return 0;
  const { queries } = dehydrate(client, {
    shouldDehydrateQuery: (query) =>
      query.state.status === "success" &&
      query.queryKey[1] === connectionId &&
      ROOTS.has(String(query.queryKey[0])),
  });
  const head = `{"connectionId":${JSON.stringify(connectionId)},"queries":[`;
  const parts: string[] = [];
  let bytes = head.length + 2;
  for (const query of queries) {
    const part = JSON.stringify({
      queryKey: query.queryKey,
      queryHash: query.queryHash,
      state: query.state,
    });
    if (bytes + part.length + 1 > maxBytes) continue;
    parts.push(part);
    bytes += part.length + 1;
  }
  if (parts.length === 0) return 0;
  storage.setItem(SNAPSHOT_KEY, `${head}${parts.join(",")}]}`);
  return parts.length;
}

export function persistConnectionSnapshots(
  client: QueryClient,
  storage: Storage = localStorage,
  delayMs = 2000,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = client.getQueryCache().subscribe((event) => {
    if (event.type !== "updated" || event.action.type !== "success" || timer) return;
    if (!ROOTS.has(String(event.query.queryKey[0]))) return;
    timer = setTimeout(() => {
      timer = undefined;
      try {
        saveConnectionSnapshot(client, storage);
      } catch {}
    }, delayMs);
  });
  return () => {
    unsubscribe();
    clearTimeout(timer);
  };
}
