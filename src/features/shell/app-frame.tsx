import { AiIsland } from "@/features/ai/ai-island";
import { AppNavRail } from "@/features/shell/app-nav-rail";
import { EasyModeOutlet } from "@/features/shell/easy-mode-outlet";
import { useAiStore } from "@/lib/ai/store";
import { useRouterSelect } from "@/lib/hooks/use-router-select";
import { useSettingsStore } from "@/lib/settings";
import { cn } from "@/lib/utils";

export function AppFrame() {
  const fullAiPage = useRouterSelect((state) => state.location.pathname === "/ai");
  const aiOpen = useAiStore((state) => state.open && !state.minimized) && !fullAiPage;
  const navInHeader = useSettingsStore((state) => state.navInHeader);
  return (
    <div className="flex min-h-0 w-full min-w-0 flex-1 overflow-hidden bg-sidebar">
      {!navInHeader && <AppNavRail />}
      <div
        data-slot="app-workspace-shell"
        className={cn(
          "relative flex min-h-0 min-w-0 flex-1 overflow-hidden rounded-tl-lg border-t border-l bg-background has-data-[slot=sidebar-inset]:rounded-none has-data-[slot=sidebar-inset]:border-0 has-data-[slot=sidebar-inset]:bg-sidebar",
          aiOpen &&
            "my-2 !rounded-xl !border !bg-background has-data-[slot=sidebar-inset]:!border-0 has-data-[slot=sidebar-inset]:!bg-sidebar",
        )}
      >
        <EasyModeOutlet />
      </div>
      <AiIsland />
    </div>
  );
}
