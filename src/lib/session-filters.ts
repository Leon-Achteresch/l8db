import type { SessionInfo } from "@/lib/db";

export interface SessionFilters {
  user: string;
  application: string;
  state: string;
  query: string;
}

export type SessionGrouping = "none" | "user" | "application";

export interface SessionGroup {
  key: string;
  label: string;
  sessions: SessionInfo[];
}

export interface BlockingInfo {
  blockedBy: number[];
  blocking: number[];
  missingBlockers: number[];
}

export const EMPTY_SESSION_FILTERS: SessionFilters = {
  user: "",
  application: "",
  state: "",
  query: "",
};

const UNGROUPED_LABEL = "(leer)";

function matchesText(
  value: string | null | undefined,
  needle: string,
): boolean {
  const n = needle.trim().toLowerCase();
  if (!n) return true;
  return (value ?? "").toLowerCase().includes(n);
}

export function isSessionFilterActive(filters: SessionFilters): boolean {
  return Object.values(filters).some((v) => v.trim() !== "");
}

export function filterSessions(
  sessions: SessionInfo[],
  filters: SessionFilters,
): SessionInfo[] {
  const state = filters.state.trim().toLowerCase();
  return sessions.filter((s) => {
    if (!matchesText(s.user, filters.user)) return false;
    if (!matchesText(s.application, filters.application)) return false;
    if (!matchesText(s.query, filters.query)) return false;
    if (state && (s.state ?? "").toLowerCase() !== state) return false;
    return true;
  });
}

export function sessionStates(sessions: SessionInfo[]): string[] {
  const set = new Set<string>();
  for (const s of sessions) if (s.state) set.add(s.state);
  return [...set].sort();
}

export function groupSessions(
  sessions: SessionInfo[],
  grouping: SessionGrouping,
): SessionGroup[] {
  if (grouping === "none") return [{ key: "", label: "", sessions }];
  const map = new Map<string, SessionInfo[]>();
  for (const s of sessions) {
    const value = grouping === "user" ? s.user : s.application;
    const key = value || "";
    const list = map.get(key);
    if (list) list.push(s);
    else map.set(key, [s]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === "") return 1;
      if (b === "") return -1;
      return a.localeCompare(b);
    })
    .map(([key, list]) => ({
      key,
      label: key || UNGROUPED_LABEL,
      sessions: list,
    }));
}

export function computeBlocking(
  sessions: SessionInfo[],
): Map<number, BlockingInfo> {
  const known = new Set(sessions.map((s) => s.pid));
  const result = new Map<number, BlockingInfo>();
  const ensure = (pid: number): BlockingInfo => {
    let info = result.get(pid);
    if (!info) {
      info = { blockedBy: [], blocking: [], missingBlockers: [] };
      result.set(pid, info);
    }
    return info;
  };
  for (const s of sessions) {
    const blockers = [...new Set(s.blocked_by ?? [])].filter(
      (pid) => pid !== s.pid,
    );
    if (blockers.length === 0) continue;
    const info = ensure(s.pid);
    for (const blocker of blockers) {
      info.blockedBy.push(blocker);
      if (known.has(blocker)) ensure(blocker).blocking.push(s.pid);
      else info.missingBlockers.push(blocker);
    }
  }
  return result;
}
