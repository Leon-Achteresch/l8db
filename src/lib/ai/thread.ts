import type { AiMessage } from "@/lib/db/ai";

interface Tree {
  messages: AiMessage[];
  leafId?: string;
}

function parents(messages: AiMessage[]) {
  return new Map(
    messages.map((message, index) => [
      message.id,
      message.parentId !== undefined ? message.parentId : (messages[index - 1]?.id ?? null),
    ]),
  );
}

export function aiThread(tree?: Tree): AiMessage[] {
  if (!tree) return [];
  const byId = new Map(tree.messages.map((message) => [message.id, message]));
  const parent = parents(tree.messages);
  const path: AiMessage[] = [];
  const seen = new Set<string | undefined>();
  let current = byId.get(tree.leafId ?? tree.messages.at(-1)?.id);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    path.unshift(current);
    current = byId.get(parent.get(current.id) ?? undefined);
  }
  return path;
}

export function aiBranches(tree?: Tree): Map<string | undefined, (string | undefined)[]> {
  const groups = new Map<string | null | undefined, (string | undefined)[]>();
  const branches = new Map<string | undefined, (string | undefined)[]>();
  for (const [id, parent] of parents(tree?.messages ?? [])) {
    const siblings = groups.get(parent) ?? [];
    groups.set(parent, siblings);
    siblings.push(id);
    branches.set(id, siblings);
  }
  return branches;
}

export function aiLatestLeaf(tree: Tree, id: string | undefined): string | undefined {
  const parent = parents(tree.messages);
  const seen = new Set<string | undefined>();
  let leaf = id;
  while (!seen.has(leaf)) {
    seen.add(leaf);
    const child = tree.messages.filter((message) => parent.get(message.id) === leaf).at(-1);
    if (!child) break;
    leaf = child.id;
  }
  return leaf;
}
