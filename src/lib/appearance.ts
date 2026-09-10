import { useSettingsStore } from "@/lib/settings";

export function initAppearance() {
  const apply = () => {
    const { uiScale, uiDensity, sidebarExtraCompact } = useSettingsStore.getState();
    document.documentElement.style.fontSize = `${uiScale}%`;
    document.documentElement.dataset.uiScale = String(uiScale);
    document.documentElement.dataset.uiDensity = uiDensity;
    document.documentElement.dataset.sidebarExtraCompact = String(sidebarExtraCompact);
  };
  apply();
  const unsubscribe = useSettingsStore.subscribe((state, previous) => {
    if (
      state.uiScale !== previous.uiScale ||
      state.uiDensity !== previous.uiDensity ||
      state.sidebarExtraCompact !== previous.sidebarExtraCompact
    )
      apply();
  });
  const sync = (event: StorageEvent) => {
    if (event.storageArea === localStorage && event.key === "l8db.settings") {
      void useSettingsStore.persist.rehydrate();
    }
  };
  window.addEventListener("storage", sync);
  return () => {
    unsubscribe();
    window.removeEventListener("storage", sync);
  };
}
