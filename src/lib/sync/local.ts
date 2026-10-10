import type { HostGroupRule } from "@/lib/connection-groups";
import type { SavedConnection } from "@/lib/connections";
import { persistedConnectionString, useConnectionsStore } from "@/lib/connections/store";
import {
  applyPortableWorkspace,
  exportPortableWorkspace,
  type PortableWorkspace,
  parsePortableWorkspace,
} from "@/lib/portable-workspace";
import { type QueryHistoryEntry, retainHistory, useQueryHistoryStore } from "@/lib/query-history";
import { type SavedQuery, useSavedQueriesStore } from "@/lib/saved-queries";
import { forgetSessionSecret } from "@/lib/secrets";
import { type Snippet, useSnippetsStore } from "@/lib/snippets";
import type { LocalCollections, LocalItem, SyncCollection } from "./payload";

export const WORKSPACE_SECTIONS = [
  "settings",
  "hotkeys",
  "layouts",
  "profiles",
  "favorites",
  "views",
] as const satisfies readonly (keyof PortableWorkspace)[];

const SECRET_SUFFIXES = ["", ":ssh", ":ssh-jumps", ":proxy", ":params"];
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function toSyncConnection(connection: SavedConnection): Record<string, unknown> {
  const { tunnelPort: _port, temporary: _temporary, commandTunnel: _command, ...rest } = connection;
  return { ...rest, connectionString: persistedConnectionString(connection.connectionString) };
}

export function collectLocal(includeHistory: boolean): LocalCollections {
  const connections = useConnectionsStore.getState();
  const workspace = exportPortableWorkspace();
  return {
    connections: connections.connections
      .filter((connection) => !connection.temporary)
      .map((connection) => ({
        id: connection.id,
        data: toSyncConnection(connection),
        source: connection,
      })),
    hostGroupRules: connections.hostGroupRules.map((rule) => ({ id: rule.id, data: rule })),
    connectionPrefs: [
      { id: "favoriteServerKeys", data: { value: connections.favoriteServerKeys } },
      { id: "serverOrder", data: { value: connections.serverOrder } },
    ],
    savedQueries: useSavedQueriesStore
      .getState()
      .queries.map((query) => ({ id: query.id, data: query })),
    snippets: useSnippetsStore
      .getState()
      .snippets.map((snippet) => ({ id: snippet.id, data: snippet, updatedAt: snippet.updatedAt })),
    history: includeHistory
      ? useQueryHistoryStore
          .getState()
          .entries.map((entry) => ({ id: entry.id, data: entry, updatedAt: entry.ranAt }))
      : [],
    workspace: WORKSPACE_SECTIONS.map((section) => ({
      id: section,
      data: { value: workspace[section] },
    })),
  };
}

export function secretAccounts(items: LocalItem[]): string[] {
  return items.flatMap((item) => {
    const connection = item.data as Partial<SavedConnection>;
    if (connection.vault || !SAFE_ID.test(item.id)) return [];
    return SECRET_SUFFIXES.map((suffix) => `${item.id}${suffix}`);
  });
}

export function forgetCachedSecrets(accounts: string[]): void {
  for (const account of accounts) forgetSessionSecret(account);
}

function byCreatedAt<T extends { createdAt?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

function stringList(items: LocalItem[], id: string): string[] | null {
  const value = (items.find((item) => item.id === id)?.data as { value?: unknown } | undefined)
    ?.value;
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : null;
}

export function mergeConnections(
  incoming: LocalItem[],
  current: SavedConnection[],
): SavedConnection[] {
  const live = new Map(current.map((connection) => [connection.id, connection]));
  const next = incoming.map((item) => {
    const data = item.data as SavedConnection;
    const known = live.get(item.id);
    if (!known) return { ...data, id: item.id };
    const sameString = persistedConnectionString(known.connectionString) === data.connectionString;
    return {
      ...data,
      id: item.id,
      connectionString: sameString ? known.connectionString : data.connectionString,
      tunnelPort: sameString ? known.tunnelPort : null,
      ...(known.commandTunnel ? { commandTunnel: known.commandTunnel } : {}),
    };
  });
  const ids = new Set(next.map((connection) => connection.id));
  return [
    ...next,
    ...current.filter((connection) => connection.temporary && !ids.has(connection.id)),
  ];
}

export function applyLocal(
  collections: LocalCollections,
  include: ReadonlySet<SyncCollection>,
): void {
  let workspace: PortableWorkspace | null = null;
  if (include.has("workspace") && collections.workspace.length > 0) {
    const current = exportPortableWorkspace() as unknown as Record<string, unknown>;
    for (const item of collections.workspace) {
      if ((WORKSPACE_SECTIONS as readonly string[]).includes(item.id))
        current[item.id] = (item.data as { value: unknown }).value;
    }
    workspace = parsePortableWorkspace(JSON.stringify(current));
  }
  if (include.has("connections") || include.has("hostGroupRules") || include.has("connectionPrefs"))
    useConnectionsStore.setState((state) => {
      const connections = include.has("connections")
        ? mergeConnections(collections.connections, state.connections)
        : state.connections;
      return {
        connections,
        activeId: connections.some((connection) => connection.id === state.activeId)
          ? state.activeId
          : null,
        hostGroupRules: include.has("hostGroupRules")
          ? collections.hostGroupRules.map((item) => item.data as HostGroupRule)
          : state.hostGroupRules,
        favoriteServerKeys: include.has("connectionPrefs")
          ? (stringList(collections.connectionPrefs, "favoriteServerKeys") ??
            state.favoriteServerKeys)
          : state.favoriteServerKeys,
        serverOrder: include.has("connectionPrefs")
          ? (stringList(collections.connectionPrefs, "serverOrder") ?? state.serverOrder)
          : state.serverOrder,
      };
    });
  if (include.has("savedQueries"))
    useSavedQueriesStore.setState({
      queries: byCreatedAt(collections.savedQueries.map((item) => item.data as SavedQuery)),
    });
  if (include.has("snippets"))
    useSnippetsStore.setState({
      snippets: byCreatedAt(collections.snippets.map((item) => item.data as Snippet)),
    });
  if (include.has("history"))
    useQueryHistoryStore.setState((state) => ({
      entries: retainHistory(
        collections.history.map((item) => item.data as QueryHistoryEntry),
        state.retentionLimit,
      ),
    }));
  if (workspace) applyPortableWorkspace(workspace);
}
