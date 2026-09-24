import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

const IDLE_DELAY_MS = 250;
const MAX_DELAY_MS = 1500;

export interface EditorStateSnapshot {
  tabId: string;
  sql?: string;
  selectedSql?: string;
  cursorOffset?: number;
}

export interface EditorStateSync {
  schedule: (patch: EditorStateSnapshot) => void;
  flush: (sync?: boolean) => void;
}

function createEditorStateSync(apply: (snapshot: EditorStateSnapshot) => void): EditorStateSync {
  let pending: EditorStateSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let since = 0;

  const flush = (sync = true) => {
    if (timer) clearTimeout(timer);
    timer = null;
    const next = pending;
    pending = null;
    if (!next) return;
    if (sync) flushSync(() => apply(next));
    else apply(next);
  };

  const schedule = (patch: EditorStateSnapshot) => {
    if (pending && pending.tabId !== patch.tabId) flush(false);
    if (!pending) since = performance.now();
    pending = { ...pending, ...patch };
    if (timer) clearTimeout(timer);
    const elapsed = performance.now() - since;
    timer = setTimeout(() => flush(), Math.max(0, Math.min(IDLE_DELAY_MS, MAX_DELAY_MS - elapsed)));
  };

  return { schedule, flush };
}

export function useEditorStateSync(apply: (snapshot: EditorStateSnapshot) => void) {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const [sync] = useState(() => createEditorStateSync((snapshot) => applyRef.current(snapshot)));

  useEffect(() => {
    const flushNow = () => sync.flush();
    const flushLater = () => sync.flush(false);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey) sync.flush();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flushLater();
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", flushNow, true);
    window.addEventListener("pagehide", flushLater);
    window.addEventListener("beforeunload", flushLater);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", flushNow, true);
      window.removeEventListener("pagehide", flushLater);
      window.removeEventListener("beforeunload", flushLater);
      document.removeEventListener("visibilitychange", onVisibility);
      flushLater();
    };
  }, [sync]);

  return sync;
}
