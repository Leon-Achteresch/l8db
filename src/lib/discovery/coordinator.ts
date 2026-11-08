import { create } from "zustand";
import { INPUT_EVENTS, isQuiet, readQuietSignals } from "@/lib/blog-suggestions/quiet";
import { useBlogSuggestionStore } from "@/lib/blog-suggestions/store";
import { useFeatureVideoStore } from "@/lib/feature-videos/store";
import { useSettingsStore } from "@/lib/settings";
import { useShortcutHintsStore } from "@/lib/shortcut-hints";
import {
  DEFAULT_DISCOVERY_SETTINGS,
  type DiscoveryChannel,
  type DiscoverySettings,
} from "./channels";

export type { DiscoveryChannel } from "./channels";

export const SURFACE_COOLDOWN_MS = 4 * 60_000;
export const MAX_AUTO_SURFACES = 6;

export interface SurfaceRequest {
  channel: DiscoveryChannel;
  id: string;
  priority: number;
  explicit?: boolean;
}

export interface ActiveSurface {
  channel: DiscoveryChannel;
  id: string;
  priority: number;
  explicit: boolean;
  since: number;
}

export interface CoordinatorState {
  active: ActiveSurface | null;
  lastAutoAt: number;
  autoCount: number;
}

export interface SurfaceContext {
  now: number;
  settings: DiscoverySettings;
  quiet: boolean;
  blocked: boolean;
}

export type SurfaceRejection =
  | "disabled"
  | "channel"
  | "busy"
  | "blocked"
  | "limit"
  | "cooldown"
  | "quiet";

export type SurfaceDecision =
  | { ok: true; preempts: boolean }
  | { ok: false; reason: SurfaceRejection };

export const INITIAL_COORDINATOR_STATE: CoordinatorState = {
  active: null,
  lastAutoAt: Number.NEGATIVE_INFINITY,
  autoCount: 0,
};

export function decideSurface(
  request: SurfaceRequest,
  state: CoordinatorState,
  context: SurfaceContext,
): SurfaceDecision {
  const { active } = state;
  if (active && active.channel === request.channel && active.id === request.id)
    return { ok: true, preempts: false };
  if (request.explicit) return { ok: true, preempts: active !== null };
  if (!context.settings.enabled) return { ok: false, reason: "disabled" };
  if (!context.settings.channels[request.channel]) return { ok: false, reason: "channel" };
  const preempts = active !== null && !active.explicit && request.priority > active.priority;
  if (active && !preempts) return { ok: false, reason: "busy" };
  if (context.blocked) return { ok: false, reason: "blocked" };
  if (state.autoCount >= MAX_AUTO_SURFACES) return { ok: false, reason: "limit" };
  if (!preempts && context.now - state.lastAutoAt < SURFACE_COOLDOWN_MS)
    return { ok: false, reason: "cooldown" };
  if (!context.quiet) return { ok: false, reason: "quiet" };
  return { ok: true, preempts };
}

export function applySurface(
  request: SurfaceRequest,
  state: CoordinatorState,
  now: number,
): CoordinatorState {
  const active = state.active;
  if (active && active.channel === request.channel && active.id === request.id) return state;
  const surface: ActiveSurface = {
    channel: request.channel,
    id: request.id,
    priority: request.priority,
    explicit: request.explicit === true,
    since: now,
  };
  if (surface.explicit) return { ...state, active: surface };
  return { active: surface, lastAutoAt: now, autoCount: state.autoCount + 1 };
}

export const useCoordinatorStore = create<CoordinatorState>()(() => ({
  ...INITIAL_COORDINATOR_STATE,
}));

let lastInput = Date.now();

export function otherSurfaceVisible(): boolean {
  return (
    useShortcutHintsStore.getState().active !== null ||
    useFeatureVideoStore.getState().activeId !== null ||
    useBlogSuggestionStore.getState().activeSlug !== null
  );
}

export function readSurfaceContext(now = Date.now()): SurfaceContext {
  const settings = useSettingsStore.getState().discovery ?? DEFAULT_DISCOVERY_SETTINGS;
  const blocked = otherSurfaceVisible();
  return {
    now,
    settings,
    blocked,
    quiet: typeof document !== "undefined" && isQuiet(readQuietSignals(lastInput, now)),
  };
}

export function requestSurface(
  request: SurfaceRequest,
  context: SurfaceContext = readSurfaceContext(),
): boolean {
  const state = useCoordinatorStore.getState();
  const decision = decideSurface(request, state, context);
  if (!decision.ok) return false;
  const next = applySurface(request, state, context.now);
  if (next !== state) useCoordinatorStore.setState(next);
  return true;
}

export function releaseSurface(channel: DiscoveryChannel, id: string): void {
  const { active } = useCoordinatorStore.getState();
  if (active?.channel === channel && active.id === id)
    useCoordinatorStore.setState({ active: null });
}

export function getActiveSurface(): ActiveSurface | null {
  return useCoordinatorStore.getState().active;
}

export function useActiveSurface(): ActiveSurface | null {
  return useCoordinatorStore((state) => state.active);
}

export function resetCoordinatorSession(): void {
  useCoordinatorStore.setState({ ...INITIAL_COORDINATOR_STATE });
}

export function installDiscoveryCoordinator(): () => void {
  lastInput = Date.now();
  const input = () => {
    lastInput = Date.now();
  };
  const options = { capture: true, passive: true };
  for (const type of INPUT_EVENTS) document.addEventListener(type, input, options);
  return () => {
    for (const type of INPUT_EVENTS) document.removeEventListener(type, input, options);
  };
}
