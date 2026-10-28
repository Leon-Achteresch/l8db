import { toast } from "sonner";
import { useFeatureVideoStore } from "@/lib/feature-videos/store";
import { useSettingsStore } from "@/lib/settings";
import { isTaskActive, useTasksStore } from "@/lib/tasks";
import { useTourStore } from "@/lib/tour/store";
import { useTransactionStore } from "@/lib/transactions";

export const UPTIME_MIN = 5 * 60_000;
export const TYPING_QUIET = 30_000;
export const EDITING_QUIET = 120_000;
export const CHECK_INTERVAL = 5_000;
export const INPUT_EVENTS = ["keydown", "pointerdown", "wheel"] as const;

const OVERLAYS =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper], .driver-popover';
const EDITABLE = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export interface QuietSignals {
  visible: boolean;
  focused: boolean;
  uptime: number;
  sinceInput: number;
  editing: boolean;
  busy: boolean;
  overlay: boolean;
  onboarding: boolean;
  video: boolean;
  urgent: boolean;
}

export function isQuiet(signals: QuietSignals): boolean {
  return (
    signals.visible &&
    signals.focused &&
    signals.uptime >= UPTIME_MIN &&
    signals.sinceInput >= (signals.editing ? EDITING_QUIET : TYPING_QUIET) &&
    !signals.busy &&
    !signals.overlay &&
    !signals.onboarding &&
    !signals.video &&
    !signals.urgent
  );
}

export function readQuietSignals(lastInput: number, now = Date.now()): QuietSignals {
  const tour = useTourStore.getState();
  return {
    visible: !document.hidden,
    focused: document.hasFocus(),
    uptime: now - performance.timeOrigin,
    sinceInput: now - lastInput,
    editing: document.activeElement?.matches(EDITABLE) === true,
    busy:
      useTasksStore.getState().tasks.some(isTaskActive) ||
      useTransactionStore.getState().transactions.length > 0,
    overlay: [...document.querySelectorAll(OVERLAYS)].some(
      (node) => node.getClientRects().length > 0,
    ),
    onboarding: !useSettingsStore.getState().onboardingDone || tour.active || tour.offerOpen,
    video: useFeatureVideoStore.getState().activeId !== null,
    urgent: toast
      .getToasts()
      .some((entry) => "type" in entry && (entry.type === "error" || entry.type === "warning")),
  };
}

export function watchQuiet(onQuiet: () => void): () => void {
  let lastInput = Date.now();
  const input = () => {
    lastInput = Date.now();
  };
  const options = { capture: true, passive: true };
  for (const type of INPUT_EVENTS) document.addEventListener(type, input, options);
  const timer = setInterval(() => {
    if (isQuiet(readQuietSignals(lastInput))) onQuiet();
  }, CHECK_INTERVAL);
  return () => {
    clearInterval(timer);
    for (const type of INPUT_EVENTS) document.removeEventListener(type, input, options);
  };
}
