import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { syncAcrossWindows } from "@/lib/window-sync";

export interface AiLimit {
  id: string;
  label: string;
  used: number;
  resetsAt: number | null;
  rejected: boolean;
}
export const AI_LIMIT_WINDOWS = 8;
export const AI_LIMIT_PROFILES = 32;
const KEY = "l8db.ai.limits";
const CLAUDE_LABELS: Record<string, string> = {
  five_hour: "5 Std.",
  seven_day: "Woche",
  seven_day_opus: "Woche · Opus",
  seven_day_sonnet: "Woche · Sonnet",
  seven_day_overage_included: "Woche · Zusatz",
  overage: "Extra",
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const finite = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
const percent = (value: number) => Math.min(100, Math.round(value * 10) / 10);
const seconds = (value: unknown) => {
  const at = finite(value);
  return at ? at * 1000 : null;
};

function windowLabel(minutes: number | null, fallback: string): string {
  if (!minutes) return fallback;
  if (minutes < 1440) return `${Math.max(1, Math.round(minutes / 60))} Std.`;
  return minutes === 10_080 ? "Woche" : `${Math.round(minutes / 1440)} Tage`;
}

export function parseAiLimits(patch: Record<string, unknown>): AiLimit[] {
  const limits: AiLimit[] = [];
  const info = object(patch.rateLimit);
  const windows = Object.entries(object(info.unifiedWindows));
  for (const [id, value] of windows) {
    const entry = object(value);
    const used = finite(entry.utilization);
    if (used === null) continue;
    limits.push({
      id: id.slice(0, 48),
      label: CLAUDE_LABELS[id] ?? id.slice(0, 24),
      used: percent(used * 100),
      resetsAt: seconds(entry.resetsAt),
      rejected: entry.status === "rejected",
    });
  }
  if (!windows.length && typeof info.rateLimitType === "string") {
    const used = finite(info.utilization);
    const rejected = info.status === "rejected";
    if (used !== null || rejected)
      limits.push({
        id: info.rateLimitType.slice(0, 48),
        label: CLAUDE_LABELS[info.rateLimitType] ?? info.rateLimitType.slice(0, 24),
        used: used === null ? 100 : percent(used * 100),
        resetsAt: seconds(info.resetsAt),
        rejected,
      });
  }
  const snapshot = object(patch.rateLimits);
  const bucket = typeof snapshot.limitId === "string" ? snapshot.limitId.slice(0, 32) : "";
  const name =
    typeof snapshot.limitName === "string" && snapshot.limitName
      ? ` · ${snapshot.limitName.slice(0, 16)}`
      : "";
  for (const slot of ["primary", "secondary"]) {
    const entry = object(snapshot[slot]);
    const used = finite(entry.usedPercent);
    if (used === null) continue;
    limits.push({
      id: `${bucket}:${slot}`,
      label: `${windowLabel(finite(entry.windowDurationMins), slot === "primary" ? "Kurz" : "Lang")}${name}`,
      used: percent(used),
      resetsAt: seconds(entry.resetsAt),
      rejected: used >= 100,
    });
  }
  return limits.slice(0, AI_LIMIT_WINDOWS);
}

export function mergeAiLimits(previous: AiLimit[], next: AiLimit[], now = Date.now()): AiLimit[] {
  const merged = new Map(previous.map((limit) => [limit.id, limit]));
  for (const limit of next) merged.set(limit.id, limit);
  return [...merged.values()]
    .filter((limit) => limit.resetsAt === null || limit.resetsAt > now)
    .slice(-AI_LIMIT_WINDOWS);
}

export function activeAiLimits(limits: AiLimit[] | undefined, now = Date.now()): AiLimit[] {
  return (limits ?? []).filter((limit) => limit.resetsAt === null || limit.resetsAt > now);
}

export function aiLimitReset(at: number | null, now = Date.now()): string {
  if (at === null) return "";
  const date = new Date(at);
  const time = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date(now).toDateString()
    ? time
    : `${date.toLocaleDateString("de-DE", { weekday: "short" })} ${time}`;
}

interface AiLimitsState {
  limits: Record<string, AiLimit[]>;
  capture: (profileId: string, patch: Record<string, unknown>) => void;
}

export const useAiLimits = create<AiLimitsState>()(
  persist(
    (set) => ({
      limits: {},
      capture: (profileId, patch) => {
        if (!patch.rateLimit && !patch.rateLimits) return;
        const parsed = parseAiLimits(patch);
        if (!parsed.length) return;
        set((state) => {
          const limits = { ...state.limits };
          delete limits[profileId];
          limits[profileId] = mergeAiLimits(state.limits[profileId] ?? [], parsed);
          for (const old of Object.keys(limits).slice(0, -AI_LIMIT_PROFILES)) delete limits[old];
          return { limits };
        });
      },
    }),
    { name: KEY, storage: createSafeJsonStorage() },
  ),
);
syncAcrossWindows(KEY, () => void useAiLimits.persist.rehydrate());
