import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { ExtensionPrompts } from "@/features/extensions/extension-prompts";
import { bootUiPlugins } from "@/features/ui-plugins/boot";
import { PluginProposals } from "@/features/ui-plugins/plugin-proposals";
import { initAppearance } from "@/lib/appearance";
import { initBootPaint } from "@/lib/boot-paint";
import { initConnectionSecrets, isMainWindow, windowConnectionId } from "@/lib/connections";
import { initCrashReporting } from "@/lib/crash-reporting";
import { reportStartup } from "@/lib/db";
import { installDiagnosticsErrorCapture } from "@/lib/diagnostics";
import { initExecutionSettings } from "@/lib/execution-settings";
import { createExtensionHost } from "@/lib/extensions/host";
import { ExtensionHostContext } from "@/lib/extensions/react-context";
import { installNativeGuards } from "@/lib/native-guards";
import { initOrganization } from "@/lib/organization";
import { useOrganizationStore } from "@/lib/organization-state";
import { loadProviders } from "@/lib/providers";
import { createAppQueryClient } from "@/lib/query-client";
import { useSettingsViewState } from "@/lib/settings-view-state";
import { activateConnectionWithToast, restoreSshTunnel } from "@/lib/ssh";
import { initTeam } from "@/lib/team/sync";
import { recordDuration, trackRoute } from "@/lib/telemetry";
import { initUsageTracking } from "@/lib/usage-tracking";
import { initWindowIntegration } from "@/lib/window-integration";
import { isPluginError } from "../packages/ui-plugin-api/src/errors";
import { router } from "./router";

performance.mark("l8db.modules");
installDiagnosticsErrorCapture();
if (!("registerProperty" in CSS)) document.documentElement.classList.add("tw-no-property");
const disposeNativeGuards = installNativeGuards();
if (import.meta.hot) import.meta.hot.dispose(disposeNativeGuards);
const disposeAppearance = initAppearance();
const executionSettings = initExecutionSettings();
if (import.meta.hot) import.meta.hot.dispose(executionSettings.dispose);
if (import.meta.hot) import.meta.hot.dispose(disposeAppearance);
const organizationReady = initOrganization();
void organizationReady
  .then(() => {
    const disposeCrashReporting = initCrashReporting();
    if (import.meta.hot) import.meta.hot.dispose(disposeCrashReporting);
  })
  .catch(() => undefined);

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

const container = document.getElementById("root") as HTMLElement;
const root = ReactDOM.createRoot(container, {
  onCaughtError: (error, info) =>
    isPluginError(error) ? console.warn(error) : console.error(error, info.componentStack),
  onRecoverableError: (error) => (isPluginError(error) ? console.warn(error) : reportError(error)),
});
function render() {
  root.render(
    <React.StrictMode>
      <HotkeysProvider defaultOptions={{ hotkey: { preventDefault: true, stopPropagation: true } }}>
        <QueryClientProvider client={queryClient}>
          <ExtensionHostContext.Provider value={extensionHost.manager}>
            <RouterProvider router={router} />
            <PluginProposals />
            <ExtensionPrompts />
          </ExtensionHostContext.Provider>
        </QueryClientProvider>
      </HotkeysProvider>
    </React.StrictMode>,
  );
}

let startupReady = false;

void organizationReady
  .then(() => {
    if (useOrganizationStore.getState().policy?.allowExtensions !== false) return bootUiPlugins();
  })
  .catch((error) => console.warn("UI-Plugins konnten nicht starten", error));

Promise.all([organizationReady, executionSettings.ready, initConnectionSecrets(), loadProviders()])
  .then(async () => {
    await initTeam(isMainWindow);
    await restoreSshTunnel();
    startupReady = true;
  })
  .catch(() => undefined)
  .finally(async () => {
    performance.mark("l8db.gate");
    await router.load().catch(() => undefined);
    new MutationObserver((_, observer) => {
      observer.disconnect();
      performance.mark("l8db.app");
      if (isMainWindow)
        void reportStartup(
          performance.timeOrigin,
          performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0,
          performance.now(),
        ).catch(() => undefined);
    }).observe(container, { childList: true });
    render();
    recordDuration("app.startup", performance.now(), { ready: String(startupReady) });
    const disposeBootPaint = initBootPaint();
    if (import.meta.hot) import.meta.hot.dispose(disposeBootPaint);
    const disposeWindowIntegration = initWindowIntegration();
    if (import.meta.hot) import.meta.hot.dispose(disposeWindowIntegration);
    if (startupReady && windowConnectionId) void activateConnectionWithToast(windowConnectionId);
    if (startupReady)
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          whenIdle(() => {
            void import("@/lib/background-services")
              .then(({ startBackgroundServices }) => startBackgroundServices(isMainWindow))
              .catch(() => undefined);
          }),
        ),
      );
    if (startupReady) {
      void extensionHost
        .start()
        .catch((error) => extensionHost.manager.log("host", "error", String(error)));
      if (!import.meta.env.DEV && isMainWindow) scheduleAutoUpdater();
    }
  });

function whenIdle(run: () => void) {
  if (typeof window.requestIdleCallback === "function")
    window.requestIdleCallback(run, { timeout: 1000 });
  else setTimeout(run, 0);
}

function scheduleAutoUpdater() {
  const schedule = () =>
    whenIdle(() => {
      void import("@/lib/auto-updater")
        .then(({ initAutoUpdater }) => initAutoUpdater())
        .catch(() => undefined);
    });
  if (document.readyState === "complete") schedule();
  else window.addEventListener("load", schedule, { once: true });
}
