import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { syncAcrossWindows } from "@/lib/window-sync";

export const MODIFIER_OVERLAY_KEY = "l8db.discovery.modifier-overlay";

interface ModifierOverlayState {
  enabled: boolean;
  setEnabled: (enabled: boolean) => void;
}

export const useModifierOverlayStore = create<ModifierOverlayState>()(
  persist(
    (set) => ({
      enabled: true,
      setEnabled: (enabled) => set({ enabled }),
    }),
    {
      name: MODIFIER_OVERLAY_KEY,
      storage: createSafeJsonStorage(),
      version: 1,
      partialize: (state) => ({ enabled: state.enabled }),
      merge: (persisted, current) => ({
        ...current,
        enabled: (persisted as { enabled?: unknown } | undefined)?.enabled !== false,
      }),
    },
  ),
);

syncAcrossWindows(MODIFIER_OVERLAY_KEY, () => void useModifierOverlayStore.persist.rehydrate());
