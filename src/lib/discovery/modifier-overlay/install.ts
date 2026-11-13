import { HOLD_MS, type ModifierInput, type ModifierKey, nextModifierPhase } from "./modifier-state";

export interface ModifierOverlayOptions {
  modifier: ModifierKey;
  onShow: () => void;
  onHide: () => void;
  holdMs?: number;
  target?: Window;
  doc?: Document;
}

const CANCEL_EVENTS = ["pointerdown", "mousedown", "wheel"] as const;

export function installModifierOverlay({
  modifier,
  onShow,
  onHide,
  holdMs = HOLD_MS,
  target = window,
  doc = document,
}: ModifierOverlayOptions): () => void {
  let phase = nextModifierPhase("idle", { type: "cancel" }, modifier);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stopTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const apply = (input: ModifierInput) => {
    const previous = phase;
    phase = nextModifierPhase(phase, input, modifier);
    if (previous === phase) return;
    if (phase === "holding") {
      stopTimer();
      timer = setTimeout(() => {
        timer = null;
        apply({ type: "elapsed" });
      }, holdMs);
      return;
    }
    stopTimer();
    if (phase === "shown") onShow();
    else if (previous === "shown") onHide();
  };
  const keydown = (event: KeyboardEvent) =>
    apply({
      type: "keydown",
      key: event.key,
      ctrlKey: event.ctrlKey,
      metaKey: event.metaKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      repeat: event.repeat,
      altGraph: event.getModifierState?.("AltGraph") === true,
    });
  const keyup = () => apply({ type: "keyup" });
  const cancel = () => apply({ type: "cancel" });
  const visibility = () => {
    if (doc.hidden) cancel();
  };
  target.addEventListener("keydown", keydown, true);
  target.addEventListener("keyup", keyup, true);
  target.addEventListener("blur", cancel);
  target.addEventListener("scroll", cancel, { capture: true, passive: true });
  for (const type of CANCEL_EVENTS)
    target.addEventListener(type, cancel, { capture: true, passive: true });
  doc.addEventListener("visibilitychange", visibility);
  return () => {
    target.removeEventListener("keydown", keydown, true);
    target.removeEventListener("keyup", keyup, true);
    target.removeEventListener("blur", cancel);
    target.removeEventListener("scroll", cancel, true);
    for (const type of CANCEL_EVENTS) target.removeEventListener(type, cancel, true);
    doc.removeEventListener("visibilitychange", visibility);
    stopTimer();
    if (phase === "shown") onHide();
    phase = "idle";
  };
}
