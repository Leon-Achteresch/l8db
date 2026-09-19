import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { ExtensionPrompts } from "@/features/extensions/extension-prompts";
import { StartupView } from "@/features/shell/startup-view";
import { initAppearance } from "@/lib/appearance";
import { initAutoUpdater } from "@/lib/auto-updater";
import { initConnectionSecrets, isMainWindow } from "@/lib/connections";
import { initMcpDashboardSync } from "@/lib/dashboards/mcp-sync";
import { installDiagnosticsErrorCapture } from "@/lib/diagnostics";
import { initExecutionSettings } from "@/lib/execution-settings";
import { createExtensionHost } from "@/lib/extensions/host";
import { ExtensionHostContext } from "@/lib/extensions/react-context";
import { initMcpSync } from "@/lib/mcp";
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

Promise.all([executionSettings.ready, loadProviders(), initConnectionSecrets()])
  .then(restoreSshTunnel)
  .then(() => {
    initMcpDashboardSync();
    return initMcpSync();
  })
  .catch(() => undefined)
  .finally(() => {
    render();
    void extensionHost
      .start()
      .catch((error) => extensionHost.manager.log("host", "error", String(error)));
  });

if (!import.meta.env.DEV && isMainWindow) {
  if (document.readyState === "complete") initAutoUpdater();
  else window.addEventListener("load", () => initAutoUpdater(), { once: true });
}
