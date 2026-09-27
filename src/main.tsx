import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { ExtensionPrompts } from "@/features/extensions/extension-prompts";
import { StartupView } from "@/features/shell/startup-view";
import { initAppearance } from "@/lib/appearance";
import { initConnectionSecrets, isMainWindow } from "@/lib/connections";
import { installDiagnosticsErrorCapture } from "@/lib/diagnostics";
import { initExecutionSettings } from "@/lib/execution-settings";
import { createExtensionHost } from "@/lib/extensions/host";
import { ExtensionHostContext } from "@/lib/extensions/react-context";
import { installNativeGuards } from "@/lib/native-guards";
import { loadProviders } from "@/lib/providers";
import { createAppQueryClient } from "@/lib/query-client";
import { restoreSshTunnel } from "@/lib/ssh";
import { router } from "./router";

installDiagnosticsErrorCapture();
const disposeNativeGuards = installNativeGuards();
if (import.meta.hot) import.meta.hot.dispose(disposeNativeGuards);
const disposeAppearance = initAppearance();
const executionSettings = initExecutionSettings();
if (import.meta.hot) import.meta.hot.dispose(executionSettings.dispose);
if (import.meta.hot) import.meta.hot.dispose(disposeAppearance);

const queryClient = createAppQueryClient();
const extensionHost = createExtensionHost();

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

Promise.all([executionSettings.ready, loadProviders(), initConnectionSecrets()])
  .then(restoreSshTunnel)
  .then(() => {
    startupReady = true;
  })
  .catch(() => undefined)
  .finally(() => {
    render();
    if (startupReady)
      requestAnimationFrame(() => {
        void import("@/lib/dashboards/mcp-sync")
          .then(({ initMcpDashboardSync }) => initMcpDashboardSync())
          .catch(() => undefined);
        void import("@/lib/mcp").then(({ initMcpSync }) => initMcpSync()).catch(() => undefined);
      });
    void extensionHost
      .start()
      .catch((error) => extensionHost.manager.log("host", "error", String(error)));
  });

if (!import.meta.env.DEV && isMainWindow) {
  const startUpdater = () => {
    void import("@/lib/auto-updater")
      .then(({ initAutoUpdater }) => initAutoUpdater())
      .catch(() => undefined);
  };
  if (document.readyState === "complete") startUpdater();
  else window.addEventListener("load", startUpdater, { once: true });
}
