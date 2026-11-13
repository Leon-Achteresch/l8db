import {
  type DiscoveryChannel,
  decideSurface,
  readSurfaceContext,
  releaseSurface,
  requestSurface,
  type SurfaceRequest,
  useCoordinatorStore,
} from "../coordinator";

export const RETRY_INTERVAL_MS = 5_000;
export const RETRY_TTL_MS = 10 * 60_000;

export type SurfaceAttempt = "granted" | "stop" | "wait";

export interface RetryOptions {
  ttlMs?: number;
  intervalMs?: number;
  attempt?: (request: SurfaceRequest) => SurfaceAttempt;
}

export function attemptSurface(request: SurfaceRequest): SurfaceAttempt {
  const context = readSurfaceContext();
  const decision = decideSurface(request, useCoordinatorStore.getState(), context);
  if (decision.ok) return requestSurface(request, context) ? "granted" : "wait";
  return decision.reason === "disabled" ||
    decision.reason === "channel" ||
    decision.reason === "limit"
    ? "stop"
    : "wait";
}

export function releaseChannel(channel: DiscoveryChannel): void {
  const active = useCoordinatorStore.getState().active;
  if (active?.channel === channel) releaseSurface(channel, active.id);
}

export function retrySurface(
  request: SurfaceRequest,
  onGranted: () => void,
  {
    ttlMs = RETRY_TTL_MS,
    intervalMs = RETRY_INTERVAL_MS,
    attempt = attemptSurface,
  }: RetryOptions = {},
): () => void {
  const first = attempt(request);
  if (first === "granted") onGranted();
  if (first !== "wait") return () => undefined;
  const deadline = Date.now() + ttlMs;
  const timer = setInterval(() => {
    const outcome = Date.now() > deadline ? "stop" : attempt(request);
    if (outcome === "wait") return;
    clearInterval(timer);
    if (outcome === "granted") onGranted();
  }, intervalMs);
  return () => clearInterval(timer);
}
