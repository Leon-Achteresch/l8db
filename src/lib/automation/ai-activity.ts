import { create } from "zustand";
import { type AiActivity, listAiActivity, onAutomationEvent } from "@/lib/db/automation";
import { useAutomationStore } from "./store";

const POLL_MS = 2000;
const FLASH_MS = 2400;

interface AiFlashState {
  flashes: Record<string, number>;
  flash: (keys: string[]) => void;
}

let nonce = 0;

export const useAiFlashStore = create<AiFlashState>()((set) => ({
  flashes: {},
  flash: (keys) => {
    if (!keys.length) return;
    const id = ++nonce;
    set((state) => ({
      flashes: { ...state.flashes, ...Object.fromEntries(keys.map((key) => [key, id])) },
    }));
    setTimeout(() => {
      set((state) => {
        const flashes = { ...state.flashes };
        for (const key of keys) if (flashes[key] === id) delete flashes[key];
        return { flashes };
      });
    }, FLASH_MS);
  },
}));

export function aiFlashKeys(entries: AiActivity[]): string[] {
  return entries.flatMap((entry) =>
    entry.action === "delete"
      ? []
      : [`task:${entry.taskId}`, ...entry.stepIds.map((id) => `step:${id}`)],
  );
}

function revealTask(entries: AiActivity[]): void {
  const target = [...entries]
    .reverse()
    .find((entry) => entry.action === "save" || entry.action === "duplicate");
  const state = useAutomationStore.getState();
  if (
    target &&
    state.view === "tasks" &&
    !state.selectedId &&
    !state.draft &&
    state.tasks.some((summary) => summary.task.id === target.taskId)
  )
    state.select(target.taskId);
}

let last: number | null = null;
let polling = false;
let again = false;

async function poll(): Promise<void> {
  if (polling) {
    again = true;
    return;
  }
  polling = true;
  try {
    const entries = await listAiActivity(last ?? 0);
    const newest = entries.at(-1)?.seq;
    if (last === null) {
      last = newest ?? 0;
      return;
    }
    if (newest === undefined) return;
    last = newest;
    const automation = useAutomationStore.getState();
    if (automation.loaded) await automation.load();
    revealTask(entries);
    useAiFlashStore.getState().flash(aiFlashKeys(entries));
  } finally {
    polling = false;
    if (again) {
      again = false;
      void poll().catch(() => undefined);
    }
  }
}

let started = false;

export function initAiActivity(): void {
  if (started) return;
  started = true;
  const tick = () => {
    if (document.visibilityState === "visible") void poll().catch(() => undefined);
  };
  tick();
  setInterval(tick, POLL_MS);
  window.addEventListener("focus", tick);
  void onAutomationEvent((event) => {
    if (event.event === "tasks_changed") tick();
  }).catch(() => undefined);
}
