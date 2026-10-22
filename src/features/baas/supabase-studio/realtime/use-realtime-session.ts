import { useCallback, useEffect, useRef, useState } from "react";
import {
  type SupabaseRealtimeChange,
  supabaseRealtimeClose,
  supabaseRealtimeOpen,
} from "@/lib/db/supabase-studio-edge";
import { applyPresence, type PresenceState } from "./realtime-presence";

export const MAX_REALTIME_MESSAGES = 500;

export interface RealtimeEntry {
  id: number;
  event: string;
  payload: unknown;
  receivedAt: number;
}

export interface RealtimeConfig {
  channel: string;
  isPrivate: boolean;
  presenceKey: string;
  changes: SupabaseRealtimeChange[];
}

export type RealtimeStatus = "idle" | "connecting" | "open" | "closed";

export function useRealtimeSession(reference: string) {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<RealtimeEntry[]>([]);
  const [presence, setPresence] = useState<PresenceState>({});
  const [paused, setPausedState] = useState(false);
  const [skipped, setSkipped] = useState(0);
  const [session, setSession] = useState<string | null>(null);
  const current = useRef<string | null>(null);
  const pausedRef = useRef(false);
  const buffer = useRef<RealtimeEntry[]>([]);
  const frame = useRef<number | null>(null);
  const nextId = useRef(0);

  const flush = useCallback(() => {
    frame.current = null;
    const batch = buffer.current.reverse();
    buffer.current = [];
    setMessages((previous) => [...batch, ...previous].slice(0, MAX_REALTIME_MESSAGES));
  }, []);

  const release = useCallback(() => {
    const id = current.current;
    current.current = null;
    if (id) void supabaseRealtimeClose(id).catch(() => undefined);
  }, []);

  useEffect(
    () => () => {
      release();
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    },
    [release],
  );

  const stop = useCallback(() => {
    release();
    setSession(null);
    setStatus("closed");
  }, [release]);

  const start = useCallback(
    (config: RealtimeConfig) => {
      release();
      const id = crypto.randomUUID();
      current.current = id;
      setSession(id);
      setError(null);
      setPresence({});
      setStatus("connecting");
      supabaseRealtimeOpen(
        reference,
        id,
        config.channel,
        config.changes,
        config.presenceKey,
        config.isPrivate,
        (event) => {
          if (current.current !== id) return;
          if (event.kind === "status") {
            setStatus(event.status);
            if (event.detail) setError(event.detail);
            if (event.status === "closed") {
              current.current = null;
              setSession(null);
            }
            return;
          }
          if (event.event === "presence_state" || event.event === "presence_diff") {
            setPresence((state) => applyPresence(state, event.event, event.payload));
          }
          if (event.event === "phx_reply" || event.event === "system") {
            const payload = event.payload as { status?: string; response?: { reason?: string } };
            if (payload?.status === "error") {
              setError(payload.response?.reason ?? JSON.stringify(payload));
            }
          }
          if (pausedRef.current) {
            setSkipped((count) => count + 1);
            return;
          }
          buffer.current.push({
            id: nextId.current++,
            event: event.event,
            payload: event.payload,
            receivedAt: event.received_at,
          });
          if (buffer.current.length > MAX_REALTIME_MESSAGES) {
            buffer.current.splice(0, buffer.current.length - MAX_REALTIME_MESSAGES);
          }
          frame.current ??= requestAnimationFrame(flush);
        },
      ).catch((reason) => {
        if (current.current !== id) return;
        current.current = null;
        setSession(null);
        setError(String(reason));
        setStatus("closed");
      });
    },
    [reference, release, flush],
  );

  const setPaused = useCallback((value: boolean) => {
    pausedRef.current = value;
    setPausedState(value);
    if (!value) setSkipped(0);
  }, []);

  const clear = useCallback(() => {
    buffer.current = [];
    setMessages([]);
    setSkipped(0);
  }, []);

  return {
    status,
    error,
    messages,
    presence,
    paused,
    skipped,
    session,
    start,
    stop,
    setPaused,
    clear,
  };
}
