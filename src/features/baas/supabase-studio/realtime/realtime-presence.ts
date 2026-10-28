type PresenceMeta = { phx_ref?: string; [key: string]: unknown };
export type PresenceState = Record<string, PresenceMeta[]>;

const MAX_PRESENCE_KEYS = 500;

function metasOf(value: unknown): PresenceMeta[] {
  const metas = (value as { metas?: unknown } | null)?.metas;
  return Array.isArray(metas) ? (metas as PresenceMeta[]) : [];
}

function entries(value: unknown): [string, PresenceMeta[]][] {
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).map(([key, item]) => [key, metasOf(item)]);
}

export function applyPresence(state: PresenceState, event: string, payload: unknown) {
  if (event === "presence_state") {
    return Object.fromEntries(entries(payload).slice(0, MAX_PRESENCE_KEYS));
  }
  const diff = payload as { joins?: unknown; leaves?: unknown } | null;
  const next: PresenceState = { ...state };
  for (const [key, metas] of entries(diff?.joins)) {
    const refs = new Set(metas.map((meta) => meta.phx_ref));
    next[key] = [...(next[key] ?? []).filter((meta) => !refs.has(meta.phx_ref)), ...metas];
  }
  for (const [key, metas] of entries(diff?.leaves)) {
    const refs = new Set(metas.map((meta) => meta.phx_ref));
    const remaining = (next[key] ?? []).filter((meta) => !refs.has(meta.phx_ref));
    if (remaining.length) next[key] = remaining;
    else delete next[key];
  }
  const keys = Object.keys(next);
  return keys.length > MAX_PRESENCE_KEYS
    ? Object.fromEntries(keys.slice(-MAX_PRESENCE_KEYS).map((key) => [key, next[key]]))
    : next;
}
