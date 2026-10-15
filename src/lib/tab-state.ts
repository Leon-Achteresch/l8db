import { type SetStateAction, useCallback, useRef, useSyncExternalStore } from "react";
import { useTableTabs } from "@/lib/table-tabs";
import type { Tab } from "@/lib/table-tabs/types";

export const TAB_STATE_LIMIT = 500;

const states = new Map<string, unknown>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notify() {
  for (const listener of listeners) listener();
}

export function tabStateKey(scope: string, field: string): string {
  return `${scope}\u0000${field}`;
}

export function queryTabScope(tabId: string): string {
  return `query:${tabId}`;
}

export function tabStateSize(): number {
  return states.size;
}

export function readTabState<T>(key: string): T | undefined {
  return states.get(key) as T | undefined;
}

function scopeOf(key: string): string {
  return key.slice(0, key.indexOf("\u0000"));
}

export function writeTabState(key: string, value: unknown) {
  const scope = scopeOf(key);
  if (scope.startsWith("query:") && !openQueries.has(scope)) return;
  states.delete(key);
  states.set(key, value);
  for (const oldest of states.keys()) {
    if (states.size <= TAB_STATE_LIMIT) break;
    states.delete(oldest);
  }
  notify();
}

export function pruneTabStates(keep: (scope: string) => boolean) {
  let changed = false;
  for (const key of states.keys()) {
    if (keep(scopeOf(key))) continue;
    states.delete(key);
    changed = true;
  }
  if (changed) notify();
}

export function useTabState<T>(key: string, initial: T) {
  const initialRef = useRef(initial);
  initialRef.current = initial;
  const stored = useSyncExternalStore(subscribe, () => states.get(key));
  const setValue = useCallback(
    (next: SetStateAction<T>) => {
      const previous = states.has(key) ? (states.get(key) as T) : initialRef.current;
      writeTabState(key, typeof next === "function" ? (next as (value: T) => T)(previous) : next);
    },
    [key],
  );
  return [states.has(key) ? (stored as T) : initial, setValue] as const;
}

function openQueryScopes(tabs: Tab[], byConnection: Record<string, Tab[]>): Set<string> {
  const scopes = new Set<string>();
  for (const tab of [...tabs, ...Object.values(byConnection).flat()]) {
    if (tab.kind === "query") scopes.add(queryTabScope(tab.id));
  }
  return scopes;
}

let openQueries = openQueryScopes(
  useTableTabs.getState().tabs,
  useTableTabs.getState().tabsByConnection,
);

useTableTabs.subscribe((state, previous) => {
  if (state.tabs === previous.tabs && state.tabsByConnection === previous.tabsByConnection) return;
  const open = openQueryScopes(state.tabs, state.tabsByConnection);
  if (open.size === openQueries.size && [...open].every((scope) => openQueries.has(scope))) return;
  openQueries = open;
  pruneTabStates((scope) => !scope.startsWith("query:") || open.has(scope));
});
