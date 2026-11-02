import { create } from "zustand";
import { persist } from "zustand/middleware";
import { canonicalizeHotkey, commandById, HOTKEY_COMMANDS, useHotkeysStore } from "@/lib/hotkeys";
import { syncAcrossWindows } from "@/lib/window-sync";

export const HINT_THRESHOLDS = [3, 8, 20] as const;
export const HINT_COOLDOWN_MS = 10 * 60_000;
export const HINT_STARTUP_GRACE_MS = 60_000;

export interface HintStat {
  clicks: number;
  shown: number;
  learned?: boolean;
  muted?: boolean;
}

export interface ActiveHint {
  id: string;
  learned: boolean;
}

interface ShortcutHintsState {
  stats: Record<string, HintStat>;
  lastShownAt: number;
  active: ActiveHint | null;
  recordClick: (id: string, now?: number) => void;
  recordKeyboard: (id: string) => void;
  mute: (id: string) => void;
  dismiss: () => void;
  reset: () => void;
}

const startedAt = Date.now();

export function shouldHint(
  stat: HintStat,
  now: number,
  lastShownAt: number,
  sinceStart = now - startedAt,
): boolean {
  if (stat.learned || stat.muted) return false;
  const threshold = HINT_THRESHOLDS[stat.shown];
  if (threshold === undefined || stat.clicks < threshold) return false;
  if (sinceStart < HINT_STARTUP_GRACE_MS) return false;
  return now - lastShownAt >= HINT_COOLDOWN_MS;
}

export const useShortcutHintsStore = create<ShortcutHintsState>()(
  persist(
    (set, get) => ({
      stats: {},
      lastShownAt: 0,
      active: null,
      recordClick: (id, now = Date.now()) => {
        if (!commandById(id)) return;
        const { stats, lastShownAt, active } = get();
        const current = stats[id] ?? { clicks: 0, shown: 0 };
        if (current.learned || current.muted) return;
        const next = { ...current, clicks: current.clicks + 1 };
        if (!active && shouldHint(next, now, lastShownAt)) {
          set({
            stats: { ...stats, [id]: { ...next, shown: next.shown + 1 } },
            lastShownAt: now,
            active: { id, learned: false },
          });
          return;
        }
        set({ stats: { ...stats, [id]: next } });
      },
      recordKeyboard: (id) => {
        const { stats, active } = get();
        const current = stats[id];
        const nextActive = active?.id === id ? { id, learned: true } : active;
        if (current?.learned && nextActive === active) return;
        set({
          stats: { ...stats, [id]: { ...(current ?? { clicks: 0, shown: 0 }), learned: true } },
          active: nextActive,
        });
      },
      mute: (id) =>
        set((state) => ({
          stats: {
            ...state.stats,
            [id]: { ...(state.stats[id] ?? { clicks: 0, shown: 0 }), muted: true },
          },
          active: state.active?.id === id ? null : state.active,
        })),
      dismiss: () => set({ active: null }),
      reset: () => set({ stats: {}, lastShownAt: 0, active: null }),
    }),
    {
      name: "l8db.shortcut-hints",
      version: 1,
      partialize: (state) => ({ stats: state.stats, lastShownAt: state.lastShownAt }),
    },
  ),
);

syncAcrossWindows("l8db.shortcut-hints", () => void useShortcutHintsStore.persist.rehydrate());

let indexFor: Record<string, string> | null = null;
let index = new Map<string, string[]>();

export function hotkeyIndex(overrides: Record<string, string>): Map<string, string[]> {
  if (indexFor === overrides) return index;
  const next = new Map<string, string[]>();
  for (const command of HOTKEY_COMMANDS) {
    const override = overrides[command.id];
    const keys = override ? [override] : [command.defaultHotkey, ...(command.aliases ?? [])];
    for (const key of keys) {
      const canonical = canonicalizeHotkey(key);
      next.set(canonical, [...(next.get(canonical) ?? []), command.id]);
    }
  }
  indexFor = overrides;
  index = next;
  return next;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"]);

export function eventHotkey(
  event: Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
  mac: boolean,
): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  const parts: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) parts.push("mod");
  if (mac && event.ctrlKey) parts.push("ctrl");
  if (event.altKey) parts.push("alt");
  if (event.shiftKey) parts.push("shift");
  const code = event.code ?? "";
  const key = /^[a-z0-9]$/i.test(event.key)
    ? event.key
    : code.startsWith("Key")
      ? code.slice(3)
      : code.startsWith("Digit")
        ? code.slice(5)
        : event.key === " "
          ? "space"
          : event.key;
  parts.push(key);
  return canonicalizeHotkey(parts.join("+"));
}

export function hotkeyTargetOf(target: EventTarget | null): string | null {
  if (typeof (target as Element | null)?.closest !== "function") return null;
  const element = target as Element;
  const marked = element.closest<HTMLElement>("[data-hotkey]");
  if (marked) return marked.dataset.hotkey ?? null;
  const item = element.closest('[role^="menuitem"]');
  return item?.querySelector<HTMLElement>("[data-hotkey]")?.dataset.hotkey ?? null;
}

export function installShortcutHints(): () => void {
  const mac = /Mac|iPhone|iPad|iPod/i.test(navigator.platform ?? "");
  const onClick = (event: MouseEvent) => {
    if (event.detail === 0) return;
    const id = hotkeyTargetOf(event.target);
    if (id) useShortcutHintsStore.getState().recordClick(id);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    const store = useShortcutHintsStore.getState();
    if (event.key === "Escape" && store.active) store.dismiss();
    const hotkey = eventHotkey(event, mac);
    if (!hotkey) return;
    const index = hotkeyIndex(useHotkeysStore.getState().overrides);
    const ids =
      index.get(hotkey) ??
      (mac ? undefined : index.get(canonicalizeHotkey(hotkey.replace("mod", "ctrl"))));
    if (!ids) return;
    const inEditor =
      typeof (event.target as Element | null)?.closest === "function" &&
      (event.target as Element).closest(".monaco-editor") !== null;
    window.setTimeout(() => {
      if (!event.defaultPrevented) return;
      for (const id of ids) {
        if (inEditor && commandById(id)?.area === "Datengitter") continue;
        useShortcutHintsStore.getState().recordKeyboard(id);
      }
    }, 0);
  };
  document.addEventListener("click", onClick, true);
  window.addEventListener("keydown", onKeyDown, true);
  return () => {
    document.removeEventListener("click", onClick, true);
    window.removeEventListener("keydown", onKeyDown, true);
  };
}
