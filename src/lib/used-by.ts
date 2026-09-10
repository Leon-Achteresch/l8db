import type { DependencyInfo } from "@/lib/db";

export type DependencyRoute =
  | { kind: "table"; schema: string; name: string }
  | { kind: "view"; schema: string; name: string }
  | { kind: "function"; schema: string; name: string; oid: string }
  | { kind: "procedure"; schema: string; name: string; oid: string }
  | null;

export function normalizeObjectType(objectType: string): string {
  return objectType.trim().toLowerCase().replace(/\s+/g, "_");
}

export function dependencyRoute(dep: DependencyInfo): DependencyRoute {
  const type = normalizeObjectType(dep.object_type);
  if (type === "table") return { kind: "table", schema: dep.owner, name: dep.name };
  if (type === "view" || type === "materialized_view") {
    return { kind: "view", schema: dep.owner, name: dep.name };
  }
  if (type === "procedure") {
    return { kind: "procedure", schema: dep.owner, name: dep.name, oid: dep.oid };
  }
  if (type === "function" || type === "routine") {
    return { kind: "function", schema: dep.owner, name: dep.name, oid: dep.oid };
  }
  return null;
}

export interface DependencyGroup {
  relation: string;
  items: DependencyInfo[];
}

export function groupDependencies(deps: DependencyInfo[]): DependencyGroup[] {
  const groups = new Map<string, DependencyInfo[]>();
  for (const dep of deps) {
    const bucket = groups.get(dep.relation);
    if (bucket) bucket.push(dep);
    else groups.set(dep.relation, [dep]);
  }
  return [...groups.entries()].map(([relation, items]) => ({ relation, items }));
}

export function filterDependencies(deps: DependencyInfo[], term: string): DependencyInfo[] {
  const needle = term.trim().toLowerCase();
  if (needle === "") return deps;
  return deps.filter((dep) =>
    `${dep.owner}.${dep.name} ${dep.object_type} ${dep.relation} ${dep.detail}`
      .toLowerCase()
      .includes(needle),
  );
}
