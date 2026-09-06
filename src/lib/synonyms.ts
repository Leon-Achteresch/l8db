import type { SynonymInfo } from "@/lib/db";

export interface SynonymTarget {
  owner: string;
  name: string;
  type: string;
}

export interface SynonymResolution {
  chain: string[];
  target: SynonymTarget | null;
  cycle: boolean;
  remote: boolean;
  unresolved: boolean;
}

const MAX_DEPTH = 20;

export function synonymKey(owner: string, name: string): string {
  return `${owner}.${name}`;
}

export function resolveSynonym(start: SynonymInfo, all: SynonymInfo[]): SynonymResolution {
  const index = new Map<string, SynonymInfo>();
  for (const item of all) {
    index.set(synonymKey(item.owner, item.name), item);
  }
  const chain: string[] = [synonymKey(start.owner, start.name)];
  const seen = new Set(chain);
  let current = start;
  let cycle = false;
  let remote = Boolean(current.db_link);

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const targetKey = synonymKey(current.target_owner, current.target_name);
    if (seen.has(targetKey)) {
      cycle = true;
      chain.push(targetKey);
      break;
    }
    const next = current.db_link ? undefined : index.get(targetKey);
    if (!next) break;
    chain.push(targetKey);
    seen.add(targetKey);
    current = next;
    remote = remote || Boolean(next.db_link);
    if (depth === MAX_DEPTH - 1) cycle = true;
  }

  if (cycle) {
    return { chain, target: null, cycle: true, remote, unresolved: true };
  }
  const target: SynonymTarget = {
    owner: current.target_owner,
    name: current.target_name,
    type: current.target_type,
  };
  const unresolved = remote || target.type === "unknown" || target.name.length === 0;
  return { chain, target, cycle: false, remote, unresolved };
}
