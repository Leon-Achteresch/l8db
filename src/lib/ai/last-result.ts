import type { QueryResult } from "@/lib/db";

interface LastResult {
  owner: string;
  connectionId: string | null;
  sql: string;
  result: QueryResult;
  at: number;
}

let last: LastResult | null = null;

export function setLastResult(entry: Omit<LastResult, "at">) {
  last = { ...entry, at: Date.now() };
}

export function clearLastResult(owner: string) {
  if (last?.owner === owner) last = null;
}

export function lastResult(connectionId: string | null): LastResult | null {
  return last && last.connectionId === connectionId ? last : null;
}
