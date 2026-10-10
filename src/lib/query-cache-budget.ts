import type { Query, QueryCache } from "@tanstack/react-query";

export const INACTIVE_QUERY_MAX_ENTRIES = 20;
export const INACTIVE_QUERY_MAX_BYTES = 16 * 1024 * 1024;
const MAX_VALUES = 16_384;
const MAX_DEPTH = 32;
const BUDGETED_ROOTS = new Set(["rows", "column-search", "source-search"]);

export function retainedDataBytes(data: unknown, limit = INACTIVE_QUERY_MAX_BYTES): number {
  let bytes = 0;
  let remaining = MAX_VALUES;
  const seen = new WeakSet<object>();
  const visit = (value: unknown, depth: number): void => {
    if (bytes > limit) return;
    if (--remaining < 0 || depth > MAX_DEPTH) {
      bytes = limit + 1;
      return;
    }
    if (typeof value === "string") {
      bytes += 24 + value.length * 2;
    } else if (value !== null && typeof value === "object") {
      if (seen.has(value)) return;
      seen.add(value);
      bytes += 64;
      if (ArrayBuffer.isView(value)) bytes += value.byteLength;
      else if (value instanceof ArrayBuffer) bytes += value.byteLength;
      else if (Array.isArray(value)) {
        bytes += value.length * 8;
        for (const entry of value) {
          visit(entry, depth + 1);
          if (bytes > limit) break;
        }
      } else {
        for (const key in value) {
          if (!Object.hasOwn(value, key)) continue;
          bytes += 32 + key.length * 2;
          visit((value as Record<string, unknown>)[key], depth + 1);
          if (bytes > limit) break;
        }
      }
    } else bytes += 8;
  };
  try {
    visit(data, 0);
  } catch {
    return limit + 1;
  }
  return bytes;
}

export function enforceQueryCacheBudget(
  cache: QueryCache,
  { maxEntries = INACTIVE_QUERY_MAX_ENTRIES, maxBytes = INACTIVE_QUERY_MAX_BYTES } = {},
) {
  const inactive = new Map<Query, number>();
  const sizes = new WeakMap<object, number>();
  let bytes = 0;
  const forget = (query: Query) => {
    const size = inactive.get(query);
    if (size === undefined) return;
    bytes -= size;
    inactive.delete(query);
  };
  const unsubscribe = cache.subscribe((event) => {
    const query = event.query;
    if (!BUDGETED_ROOTS.has(String(query.queryKey[0]))) return;
    if (event.type === "removed") {
      forget(query);
      return;
    }
    if (
      event.type !== "updated" &&
      event.type !== "observerAdded" &&
      event.type !== "observerRemoved"
    )
      return;
    forget(query);
    if (
      query.getObserversCount() > 0 ||
      query.state.fetchStatus !== "idle" ||
      query.state.data === undefined ||
      cache.get(query.queryHash) !== query
    )
      return;
    const data = query.state.data;
    const size =
      data !== null && typeof data === "object"
        ? (sizes.get(data) ?? retainedDataBytes(data, maxBytes))
        : retainedDataBytes(data, maxBytes);
    if (data !== null && typeof data === "object") sizes.set(data, size);
    if (size > maxBytes) {
      cache.remove(query);
      return;
    }
    inactive.set(query, size);
    bytes += size;
    while (inactive.size > maxEntries || bytes > maxBytes) {
      const oldest = inactive.keys().next().value;
      if (!oldest) break;
      forget(oldest);
      cache.remove(oldest);
    }
  });
  return () => {
    unsubscribe();
    inactive.clear();
  };
}
