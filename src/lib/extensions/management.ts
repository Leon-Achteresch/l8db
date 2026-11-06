import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createSafeJsonStorage } from "@/lib/buffered-storage";
import { useOrganizationStore } from "@/lib/organization-state";
import { syncAcrossWindows } from "@/lib/window-sync";

export type ExtensionSource = "Eigene" | "KI" | "Galerie" | "Import";
export function assertExtensionsAllowed() {
  if (useOrganizationStore.getState().policy?.allowExtensions === false)
    throw new Error("Erweiterungen sind durch die Organisation abgeschaltet.");
}
export const useExtensionSources = create<{
  sources: Record<string, ExtensionSource>;
  mark: (key: string, source: ExtensionSource) => void;
}>()(
  persist(
    (set) => ({
      sources: {},
      mark: (key, source) => set((state) => ({ sources: { ...state.sources, [key]: source } })),
    }),
    { name: "l8db.extension-sources", storage: createSafeJsonStorage() },
  ),
);
syncAcrossWindows("l8db.extension-sources", () => void useExtensionSources.persist.rehydrate());
