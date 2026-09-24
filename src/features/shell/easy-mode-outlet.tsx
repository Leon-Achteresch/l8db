import { Navigate, useRouterState } from "@tanstack/react-router";
import { DeferredOutlet } from "@/features/shell/deferred-outlet";
import { isEasyModeRouteVisible } from "@/lib/easy-mode";
import { useSettingsStore } from "@/lib/settings";

export function EasyModeOutlet() {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const visible = useRouterState({
    select: (state) => isEasyModeRouteVisible(state.location.pathname, easyMode),
  });
  return visible ? <DeferredOutlet /> : <Navigate to="/" replace />;
}
