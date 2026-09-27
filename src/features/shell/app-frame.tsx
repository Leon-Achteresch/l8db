import { AppNavRail } from "@/features/shell/app-nav-rail";
import { EasyModeOutlet } from "@/features/shell/easy-mode-outlet";
import { useSettingsStore } from "@/lib/settings";

export function AppFrame() {
  const navInHeader = useSettingsStore((state) => state.navInHeader);
  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden bg-sidebar">
      {!navInHeader && <AppNavRail />}
      <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-xl border-t border-l bg-background shadow-lg shadow-black/10 dark:shadow-black/40 has-data-[slot=sidebar-inset]:rounded-none has-data-[slot=sidebar-inset]:border-0 has-data-[slot=sidebar-inset]:bg-sidebar has-data-[slot=sidebar-inset]:shadow-none">
        <EasyModeOutlet />
      </div>
    </div>
  );
}
