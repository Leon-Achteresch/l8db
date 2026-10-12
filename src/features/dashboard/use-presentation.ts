import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useRef, useState } from "react";

function setFullscreen(on: boolean): void {
  void getCurrentWindow()
    .setFullscreen(on)
    .catch(() => undefined);
}

export function usePresentation() {
  const [presenting, setPresenting] = useState(false);
  const active = useRef(false);
  const start = useCallback(() => {
    active.current = true;
    setPresenting(true);
    setFullscreen(true);
  }, []);
  const stop = useCallback(() => {
    active.current = false;
    setPresenting(false);
    setFullscreen(false);
  }, []);
  useEffect(() => {
    if (!presenting) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) stop();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
  }, [presenting, stop]);
  useEffect(
    () => () => {
      if (active.current) setFullscreen(false);
    },
    [],
  );
  return { presenting, start, stop };
}
