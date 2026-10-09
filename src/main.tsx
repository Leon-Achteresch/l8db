import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { ExtensionPrompts } from "@/features/extensions/extension-prompts";
import { StartupView } from "@/features/shell/startup-view";
import { initAppearance } from "@/lib/appearance";
import { initConnectionSecrets, isMainWindow, windowConnectionId } from "@/lib/connections";
import { initCrashReporting } from "@/lib/crash-reporting";
import { installDiagnosticsErrorCapture } from "@/lib/diagnostics";
import { initExecutionSettings } from "@/lib/execution-settings";
import { createExtensionHost } from "@/lib/extensions/host";
import { ExtensionHostContext } from "@/lib/extensions/react-context";
import { installNativeGuards } from "@/lib/native-guards";
import { loadProviders } from "@/lib/providers";
import { createAppQueryClient } from "@/lib/query-client";
import { useSettingsViewState } from "@/lib/settings-view-state";
import { activateConnectionWithToast, restoreSshTunnel } from "@/lib/ssh";
import { recordDuration, trackRoute } from "@/lib/telemetry";
import { initUsageTracking } from "@/lib/usage-tracking";
import { initWindowIntegration } from "@/lib/window-integration";
import { router } from "./router";

installDiagnosticsErrorCapture();
const disposeNativeGuards = installNativeGuards();
if (import.meta.hot) import.meta.hot.dispose(disposeNativeGuards);
const disposeAppearance = initAppearance();
const executionSettings = initExecutionSettings();
if (import.meta.hot) import.meta.hot.dispose(executionSettings.dispose);
if (import.meta.hot) import.meta.hot.dispose(disposeAppearance);
const disposeCrashReporting = initCrashReporting();
if (import.meta.hot) import.meta.hot.dispose(disposeCrashReporting);

const usageTracking = initUsageTracking();
if (import.meta.hot) import.meta.hot.dispose(usageTracking.dispose);
const unsubscribeUsageRoute = router.subscribe("onResolved", () => {
  const route = router.state.matches.at(-1)?.routeId;
  const tab = (router.state.location.search as { tab?: string }).tab;
  if (!route) return;
  trackRoute(route);
  usageTracking.view(
    route.endsWith("/settings")
      ? `/settings/${tab ?? useSettingsViewState.getState().category}`
      : route,
  );
});
if (import.meta.hot) import.meta.hot.dispose(unsubscribeUsageRoute);

const queryClient = createAppQueryClient();
const extensionHost = createExtensionHost();

for (const match of router.matchRoutes(router.state.location))
  void router
    .loadRouteChunk(router.routesById[match.routeId as keyof typeof router.routesById])
    ?.catch(() => undefined);

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(<StartupView />);

function render() {
  root.render(
    <React.StrictMode>
      <HotkeysProvider defaultOptions={{ hotkey: { preventDefault: true, stopPropagation: true } }}>
        <QueryClientProvider client={queryClient}>
          <ExtensionHostContext.Provider value={extensionHost.manager}>
            <RouterProvider router={router} />
            <ExtensionPrompts />
          </ExtensionHostContext.Provider>
        </QueryClientProvider>
      </HotkeysProvider>
    </React.StrictMode>,
  );
}

let startupReady = false;

Promise.all([
  executionSettings.ready,
  initConnectionSecrets(),
  loadProviders().then(restoreSshTunnel),
])
  .then(() => {
    startupReady = true;
  })
  .catch(() => undefined)
  .finally(() => {
    render();
    recordDuration("app.startup", performance.now(), { ready: String(startupReady) });
    const disposeWindowIntegration = initWindowIntegration();
    if (import.meta.hot) import.meta.hot.dispose(disposeWindowIntegration);
    if (startupReady && windowConnectionId) void activateConnectionWithToast(windowConnectionId);
    if (startupReady)
      requestAnimationFrame(() => {
        void import("@/lib/dashboards/mcp-sync")
          .then(({ initMcpDashboardSync }) => initMcpDashboardSync())
          .catch(() => undefined);
        void import("@/lib/mcp").then(({ initMcpSync }) => initMcpSync()).catch(() => undefined);
        void import("@/lib/automation/sync")
          .then(({ initAutomationSync }) => initAutomationSync())
          .catch(() => undefined);
        void import("@/lib/automation/ai-activity")
          .then(({ initAiActivity }) => initAiActivity())
          .catch(() => undefined);
        if (isMainWindow)
          void import("@/lib/mcp-open")
            .then(({ initMcpOpen }) => initMcpOpen())
            .catch(() => undefined);
      });
    void extensionHost
      .start()
      .catch((error) => extensionHost.manager.log("host", "error", String(error)));
    if (!import.meta.env.DEV && isMainWindow) scheduleAutoUpdater();
  });

function scheduleAutoUpdater() {
  const schedule = () => {
    const start = () => {
      void import("@/lib/auto-updater")
        .then(({ initAutoUpdater }) => initAutoUpdater())
        .catch(() => undefined);
    };
    if (typeof window.requestIdleCallback === "function")
      window.requestIdleCallback(start, { timeout: 1000 });
    else setTimeout(start, 0);
  };
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
}
