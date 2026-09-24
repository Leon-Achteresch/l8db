import { Navigate, useRouterState } from "@tanstack/react-router";
import { DeferredOutlet } from "@/features/shell/deferred-outlet";
import { isEasyModeRouteVisible } from "@/lib/easy-mode";
import { useSettingsStore } from "@/lib/settings";

export function EasyModeOutlet() {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return isEasyModeRouteVisible(pathname, easyMode) ? (
    <DeferredOutlet />
  ) : (
    <Navigate to="/" replace />
  );
}
