import { isReadOnlyConnection, type SavedConnection, useConnectionsStore } from "@/lib/connections";
import { isProduction, isProductionLocked } from "@/lib/environments";
import { effectiveConnectionString } from "@/lib/ssh";
import { useTransactionStore } from "@/lib/transactions";

const IGNORED_PARAMS = new Set(["options", "schema", "search_path", "currentSchema"]);

function connectionIdentity(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!url.host) return null;
  const params = [...url.searchParams]
    .filter(([key]) => !IGNORED_PARAMS.has(key))
    .map(([key, entry]) => `${key}=${entry}`)
    .sort();
  return `${url.protocol}//${url.username}@${url.host.toLowerCase()}${url.pathname}?${params.join("&")}`;
}

function effectiveOrNull(entry: SavedConnection): string | null {
  try {
    return effectiveConnectionString(entry);
  } catch {
    return null;
  }
}

function guardRank(connection: SavedConnection): number {
  if (isProductionLocked(connection)) return 0;
  if (isProduction(connection)) return 1;
  if (isReadOnlyConnection(connection)) return 2;
  return 3;
}

export function operationConnections(
  args: Record<string, unknown>,
  match: "identity" | "exact" = "identity",
): SavedConnection[] {
  const tx = useTransactionStore.getState().transactions.find((entry) => entry.txId === args.txId);
  const { connections } = useConnectionsStore.getState();
  if (tx) return connections.filter((entry) => entry.id === tx.connectionId);
  const connectionString = args.connectionString;
  if (typeof connectionString !== "string" || !connectionString) return [];
  const candidates = connections.map((entry) => ({ entry, effective: effectiveOrNull(entry) }));
  const exact = candidates.filter((candidate) => candidate.effective === connectionString);
  const identity = connectionIdentity(connectionString);
  const matches =
    match === "exact" && exact.length
      ? exact
      : candidates.filter(
          (candidate) =>
            candidate.effective === connectionString ||
            (identity !== null &&
              candidate.effective !== null &&
              identity === connectionIdentity(candidate.effective)),
        );
  return matches
    .map((candidate) => candidate.entry)
    .sort((left, right) => guardRank(left) - guardRank(right));
}

export function operationContext(args: Record<string, unknown>) {
  const tx = useTransactionStore.getState().transactions.find((entry) => entry.txId === args.txId);
  const connection = operationConnections(args)[0];
  return {
    connectionId: connection?.id,
    connectionName: connection?.name ?? "Datenbankverbindung",
    database: typeof args.database === "string" ? args.database : (tx?.database ?? null),
    kind: connection?.kind ?? (typeof args.kind === "string" ? args.kind : undefined),
  };
}
