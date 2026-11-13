import { matchesKeyboardEvent } from "@tanstack/react-hotkeys";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import {
  resolveWhatsThis,
  WHATS_THIS_COMMAND,
  type WhatsThisMatch,
} from "@/lib/discovery/whats-this/whats-this";
import { onHotkeyAction } from "@/lib/hotkeys/actions";
import { detectHotkeyPlatform } from "@/lib/hotkeys/display";
import { resolveHotkey } from "@/lib/hotkeys/use-hotkeys-store";

const WhatsThisPopover = lazy(() =>
  import("./whats-this-popover").then((module) => ({ default: module.WhatsThisPopover })),
);

export function WhatsThisHost() {
  const [picked, setPicked] = useState<{ element: Element; match: WhatsThisMatch } | null>(null);
  const picking = useRef<AbortController | null>(null);

  useEffect(() => {
    const platform = detectHotkeyPlatform();
    const start = async () => {
      if (picking.current) return;
      setPicked(null);
      const controller = new AbortController();
      picking.current = controller;
      try {
        const { pickElement } = await import("@/lib/dom-picker");
        const element = await pickElement(controller.signal);
        if (element && !controller.signal.aborted)
          setPicked({ element, match: resolveWhatsThis(element) });
      } finally {
        if (picking.current === controller) picking.current = null;
      }
    };
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (!matchesKeyboardEvent(event, resolveHotkey(WHATS_THIS_COMMAND), platform)) return;
      event.preventDefault();
      event.stopPropagation();
      void start();
    };
    window.addEventListener("keydown", keydown, true);
    const stopAction = onHotkeyAction(WHATS_THIS_COMMAND, () => void start());
    return () => {
      window.removeEventListener("keydown", keydown, true);
      stopAction();
      picking.current?.abort();
      picking.current = null;
    };
  }, []);

  if (!picked) return null;
  return (
    <Suspense fallback={null}>
      <WhatsThisPopover
        element={picked.element}
        match={picked.match}
        onClose={() => setPicked(null)}
      />
    </Suspense>
  );
}
