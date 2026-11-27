import type { BaasConnection } from "@/features/baas/use-baas-connections";
import {
  connectionSearchText,
  groupByServer,
  type HostGroupRule,
  type ServerGroup,
  sortServerGroups,
} from "@/lib/connection-groups";
import { type SavedConnection, sortConnectionsByName } from "@/lib/connections/types";
import { matchSupabaseProjects } from "./supabase-project-matches";

export function createConnectionListing(
  connections: SavedConnection[],
  baas: BaasConnection[],
  rules: HostGroupRule[],
  favoriteKeys: string[],
  order: string[],
) {
  const { visible, databaseByProject } = matchSupabaseProjects(connections, baas);
  const sorted = sortConnectionsByName(visible);
  const groups = sortServerGroups(groupByServer(sorted, rules), favoriteKeys, order);
  const favorites = new Set(favoriteKeys);
  const hasFavorites = groups.some(
    (group) => favorites.has(group.key) || group.connections.some((entry) => entry.favorite),
  );
  const textByConnection = new Map<SavedConnection, string>();

  function filter(query: string, favoritesOnly: boolean) {
    const needle = query.trim().toLowerCase();
    if (!needle && !favoritesOnly) return { groups, connections: sorted };
    const matches = new Set<SavedConnection>();
    const matchingGroups: ServerGroup[] = [];
    for (const group of groups) {
      const groupMatches = !needle || group.label.toLowerCase().includes(needle);
      const groupFavorite = favorites.has(group.key);
      const members = group.connections.filter((connection) => {
        if (favoritesOnly && !groupFavorite && !connection.favorite) return false;
        if (groupMatches) return true;
        let text = textByConnection.get(connection);
        if (text === undefined) {
          text = connectionSearchText(connection);
          textByConnection.set(connection, text);
        }
        return text.includes(needle);
      });
      if (members.length === 0) continue;
      for (const member of members) matches.add(member);
      matchingGroups.push(
        members.length === group.connections.length
          ? group
          : { ...group, kind: members[0].kind, connections: members },
      );
    }
    return {
      groups: matchingGroups,
      connections: sorted.filter((connection) => matches.has(connection)),
    };
  }
  return { groups, count: sorted.length, hasFavorites, filter, databaseByProject };
}
