import { Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { isEasyModeRouteVisible } from "@/lib/easy-mode";
import { useSettingsStore } from "@/lib/settings";

export function EasyModeOutlet() {
  const easyMode = useSettingsStore((state) => state.easyMode);
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return isEasyModeRouteVisible(pathname, easyMode) ? <Outlet /> : <Navigate to="/" replace />;
}
