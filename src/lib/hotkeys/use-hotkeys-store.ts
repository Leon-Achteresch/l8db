import type { Hotkey } from "@tanstack/react-hotkeys";
import { useMemo } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { commandById, HOTKEY_COMMANDS } from "./commands";

interface HotkeysState {
  overrides: Record<string, string>;
  setOverride: (id: string, hotkey: string | null) => void;
  resetAll: () => void;
}

export const useHotkeysStore = create<HotkeysState>()(
  persist(
    (set) => ({
      overrides: {},
      setOverride: (id, hotkey) =>
        set((state) => {
          if (hotkey === null) {
            if (!(id in state.overrides)) return state;
            const next = { ...state.overrides };
            delete next[id];
            return { overrides: next };
          }
          if (state.overrides[id] === hotkey) return state;
          return { overrides: { ...state.overrides, [id]: hotkey } };
        }),
      resetAll: () => set({ overrides: {} }),
    }),
    { name: "l8db.hotkeys", version: 1 },
  ),
);

export function resolveHotkey(id: string, overrides?: Record<string, string>): Hotkey {
  const command = commandById(id);
  const fallback = command?.defaultHotkey ?? ("Escape" as Hotkey);
  const raw = overrides?.[id] ?? useHotkeysStore.getState().overrides[id] ?? fallback;
  return raw as Hotkey;
}

export function useResolvedHotkey(id: string): Hotkey {
  const override = useHotkeysStore((state) => state.overrides[id]);
  return useMemo(() => {
    const command = commandById(id);
    return ((override ?? command?.defaultHotkey ?? "Escape") as Hotkey) ?? ("Escape" as Hotkey);
  }, [id, override]);
}

export function useAllResolvedHotkeys(): Record<string, Hotkey> {
  const overrides = useHotkeysStore((state) => state.overrides);
  return useMemo(() => {
    const resolved: Record<string, Hotkey> = {};
    for (const command of HOTKEY_COMMANDS) {
      resolved[command.id] = (overrides[command.id] ?? command.defaultHotkey) as Hotkey;
    }
    return resolved;
  }, [overrides]);
}
