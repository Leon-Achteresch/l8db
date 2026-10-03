import { CLUSTER_MAX_TABLES } from "@/features/er-diagram/er-diagram-view/constants";
import type { ERSchema, ERTable, ForeignKeyInfo } from "@/lib/db";
import { createErClusterLabel } from "@/lib/er-cluster-label";
import { erTableKey, erTableKeyOf } from "@/lib/er-focus";

export interface ErCluster {
  id: string;
  label: string;
  tables: ERTable[];
  foreignKeys: ForeignKeyInfo[];
  relatedForeignKeys: ForeignKeyInfo[];
  isolated: boolean;
}

export interface ErClusterLink {
  id: string;
  source: string;
  target: string;
  foreignKeys: ForeignKeyInfo[];
}

export function erForeignKeyKey(fk: ForeignKeyInfo): string {
  return JSON.stringify([fk.from_schema, fk.from_table, fk.constraint_name]);
}

export function buildErClusters(schema: ERSchema): {
  clusters: ErCluster[];
  links: ErClusterLink[];
} {
  const tables = new Map(schema.tables.map((table) => [erTableKeyOf(table), table]));
  const keys = [...tables.keys()].sort();
  const neighbors = new Map(keys.map((key) => [key, new Map<string, number>()]));
  const foreignKeys = schema.foreign_keys
    .filter(
      (fk) =>
        tables.has(erTableKey(fk.from_schema, fk.from_table)) &&
        tables.has(erTableKey(fk.to_schema, fk.to_table)),
    )
    .sort(
      (a, b) =>
        erForeignKeyKey(a).localeCompare(erForeignKeyKey(b)) ||
        a.from_column.localeCompare(b.from_column) ||
        a.to_column.localeCompare(b.to_column),
    );
  const seenConstraints = new Set<string>();
  const linked = new Set<string>();
  for (const fk of foreignKeys) {
    const from = erTableKey(fk.from_schema, fk.from_table);
    const to = erTableKey(fk.to_schema, fk.to_table);
    linked.add(from);
    linked.add(to);
    const constraint = erForeignKeyKey(fk);
    if (seenConstraints.has(constraint) || from === to) continue;
    seenConstraints.add(constraint);
    const fromNeighbors = neighbors.get(from);
    const toNeighbors = neighbors.get(to);
    fromNeighbors?.set(to, (fromNeighbors.get(to) ?? 0) + 1);
    toNeighbors?.set(from, (toNeighbors.get(from) ?? 0) + 1);
  }

  const degree = new Map(
    keys.map((key) => [key, [...(neighbors.get(key)?.values() ?? [])].reduce((a, b) => a + b, 0)]),
  );
  const componentDegree = new Map<string, number>();
  for (const start of keys) {
    if (componentDegree.has(start)) continue;
    const members = [start];
    const visited = new Set([start]);
    for (let index = 0; index < members.length; index++) {
      for (const neighbor of neighbors.get(members[index])?.keys() ?? []) {
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        members.push(neighbor);
      }
    }
    const total = members.reduce((sum, key) => sum + (degree.get(key) ?? 0), 0);
    for (const key of members) componentDegree.set(key, total);
  }
  const parent = new Map(keys.map((key) => [key, key]));
  const sizes = new Map(keys.map((key) => [key, 1]));
  const communityDegree = new Map(degree);
  const communityNeighbors = new Map(keys.map((key) => [key, new Map(neighbors.get(key))]));
  const root = (key: string): string => {
    let current = key;
    while (parent.get(current) !== current) current = parent.get(current) ?? current;
    while (key !== current) {
      const next = parent.get(key) ?? current;
      parent.set(key, current);
      key = next;
    }
    return current;
  };
  const pairs = keys.flatMap((from) =>
    [...(neighbors.get(from)?.entries() ?? [])]
      .filter(([to]) => from < to)
      .map(([to, weight]) => ({
        from,
        to,
        strength: weight / Math.sqrt((degree.get(from) ?? 1) * (degree.get(to) ?? 1)),
      })),
  );
  pairs.sort(
    (a, b) => b.strength - a.strength || a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
  );
  for (const { from, to } of pairs) {
    const left = root(from);
    const right = root(to);
    if (left === right) continue;
    const size = (sizes.get(left) ?? 1) + (sizes.get(right) ?? 1);
    if (size > CLUSTER_MAX_TABLES) continue;
    const weight = communityNeighbors.get(left)?.get(right) ?? 0;
    const expected =
      ((communityDegree.get(left) ?? 0) * (communityDegree.get(right) ?? 0)) /
      (componentDegree.get(from) ?? 1);
    if (weight <= expected) continue;
    const first = left < right ? left : right;
    const second = left < right ? right : left;
    parent.set(second, first);
    sizes.set(first, size);
    communityDegree.set(
      first,
      (communityDegree.get(first) ?? 0) + (communityDegree.get(second) ?? 0),
    );
    const firstNeighbors = communityNeighbors.get(first);
    const secondNeighbors = communityNeighbors.get(second);
    firstNeighbors?.delete(second);
    for (const [neighbor, weight] of secondNeighbors ?? []) {
      const neighborRoot = root(neighbor);
      if (neighborRoot === first) continue;
      const combined = (firstNeighbors?.get(neighborRoot) ?? 0) + weight;
      firstNeighbors?.set(neighborRoot, combined);
      communityNeighbors.get(neighborRoot)?.delete(second);
      communityNeighbors.get(neighborRoot)?.set(first, combined);
    }
    communityNeighbors.delete(second);
  }

  const groups = new Map<string, ERTable[]>();
  const isolatedCounts = new Map<string, number>();
  for (const key of keys) {
    const table = tables.get(key);
    if (!table) continue;
    let group = `linked:${root(key)}`;
    if (!linked.has(key)) {
      const index = isolatedCounts.get(table.schema) ?? 0;
      group = `isolated:${JSON.stringify([table.schema, Math.floor(index / CLUSTER_MAX_TABLES)])}`;
      isolatedCounts.set(table.schema, index + 1);
    }
    const members = groups.get(group);
    if (members) members.push(table);
    else groups.set(group, [table]);
  }

  const clusters: ErCluster[] = [...groups.values()].map((members, index) => {
    members.sort(
      (a, b) =>
        (degree.get(erTableKeyOf(b)) ?? 0) - (degree.get(erTableKeyOf(a)) ?? 0) ||
        erTableKeyOf(a).localeCompare(erTableKeyOf(b)),
    );
    const isolated = members.every((table) => !linked.has(erTableKeyOf(table)));
    return {
      id: `cluster:${JSON.stringify(members.map(erTableKeyOf).sort())}`,
      label: createErClusterLabel(members, degree, index, isolated),
      tables: members,
      foreignKeys: [],
      relatedForeignKeys: [],
      isolated,
    };
  });
  const labelCounts = new Map<string, number>();
  for (const cluster of clusters) {
    const count = (labelCounts.get(cluster.label) ?? 0) + 1;
    labelCounts.set(cluster.label, count);
    if (count > 1) cluster.label += ` · ${count}`;
  }
  const tableClusters = new Map(
    clusters.flatMap((cluster) =>
      cluster.tables.map((table) => [erTableKeyOf(table), cluster] as const),
    ),
  );
  const links = new Map<string, ErClusterLink>();
  for (const fk of foreignKeys) {
    const from = tableClusters.get(erTableKey(fk.from_schema, fk.from_table));
    const to = tableClusters.get(erTableKey(fk.to_schema, fk.to_table));
    if (!from || !to) continue;
    from.relatedForeignKeys.push(fk);
    if (from === to) {
      from.foreignKeys.push(fk);
      continue;
    }
    to.relatedForeignKeys.push(fk);
    const id = JSON.stringify([from.id, to.id]);
    const link = links.get(id);
    if (link) link.foreignKeys.push(fk);
    else links.set(id, { id, source: from.id, target: to.id, foreignKeys: [fk] });
  }
  return { clusters, links: [...links.values()] };
}
