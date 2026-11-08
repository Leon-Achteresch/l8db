import { useCallback, useEffect, useRef } from "react";
import {
  releaseSurface,
  requestSurface,
  type SurfaceRequest,
  useActiveSurface,
} from "@/lib/discovery/coordinator";

export const SLOT_RETRY_MS = 15_000;

export function useSurfaceSlot(request: SurfaceRequest | null) {
  const active = useActiveSurface();
  const current = useRef(request);
  current.current = request;
  const key = request ? `${request.channel}:${request.id}` : null;
  const visible =
    request !== null && active?.channel === request.channel && active.id === request.id;

  useEffect(() => {
    if (!key || visible) return;
    const attempt = () => {
      const next = current.current;
      if (next && !document.hidden) requestSurface(next);
    };
    attempt();
    const timer = window.setInterval(attempt, SLOT_RETRY_MS);
    return () => window.clearInterval(timer);
  }, [key, visible]);

  const channel = request?.channel;
  const id = request?.id;
  useEffect(() => {
    if (!visible || !channel || !id) return;
    return () => releaseSurface(channel, id);
  }, [visible, channel, id]);

  const release = useCallback(() => {
    const next = current.current;
    if (next) releaseSurface(next.channel, next.id);
  }, []);

  return { visible, release };
}
