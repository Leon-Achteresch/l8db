export type FeatureEventValue = string | number | boolean | null;
export type FeatureEventData = Readonly<Record<string, FeatureEventValue>>;

export interface FeatureEvent {
  name: string;
  data: FeatureEventData;
  at: number;
}

type FeatureEventListener = (event: FeatureEvent) => void;

const listeners = new Set<FeatureEventListener>();
let queryCounter = 0;

export function onFeatureEvent(listener: FeatureEventListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function hasFeatureEventListeners(): boolean {
  return listeners.size > 0;
}

export function recordFeatureEvent(name: string, data: FeatureEventData = {}): void {
  if (listeners.size === 0) return;
  const event: FeatureEvent = { name, data, at: Date.now() };
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (error) {
      console.warn(`Discovery-Ereignis ${name} fehlgeschlagen.`, error);
    }
  }
}

export function hashFeatureValue(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function normalizeSqlForHash(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

export function beginQueryEvent(sql: string, family?: string | null): (ok: boolean) => void {
  if (listeners.size === 0) return () => undefined;
  const id = `q${++queryCounter}`;
  const startedAt = performance.now();
  const kind = family ?? null;
  recordFeatureEvent("query.started", { id, family: kind });
  let finished = false;
  return (ok) => {
    if (finished) return;
    finished = true;
    const durationMs = Math.round(performance.now() - startedAt);
    const normalized = normalizeSqlForHash(sql);
    recordFeatureEvent("query.finished", { id, ok, durationMs, family: kind });
    recordFeatureEvent("query.executed", {
      id,
      hash: hashFeatureValue(normalized),
      length: normalized.length,
      durationMs,
      ok,
      hasJoin: /\bjoin\b/.test(normalized),
      hasWhere: /\bwhere\b/.test(normalized),
      family: kind,
    });
  };
}
