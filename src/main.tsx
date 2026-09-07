import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { StartupView } from "@/features/shell/startup-view";
import { ExtensionPrompts } from "@/features/extensions/extension-prompts";
import { initAutoUpdater } from "@/lib/auto-updater";
import { initConnectionSecrets } from "@/lib/connections";
import { installDiagnosticsErrorCapture } from "@/lib/diagnostics";
import { createExtensionHost } from "@/lib/extensions/host";
import { ExtensionHostContext } from "@/lib/extensions/react-context";
import { loadProviders } from "@/lib/providers";
import { createAppQueryClient } from "@/lib/query-client";
import { restoreSshTunnel } from "@/lib/ssh";
import { router } from "./router";

installDiagnosticsErrorCapture();

const queryClient = createAppQueryClient();
const extensionHost = createExtensionHost();

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(<StartupView />);

function render() {
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <ExtensionHostContext.Provider value={extensionHost.manager}>
          <RouterProvider router={router} />
          <ExtensionPrompts />
        </ExtensionHostContext.Provider>
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

Promise.all([loadProviders(), initConnectionSecrets()])
  .then(restoreSshTunnel)
  .catch(() => undefined)
  .finally(() => {
    render();
    void extensionHost
      .start()
      .catch((error) => extensionHost.manager.log("host", "error", String(error)));
  });

if (!import.meta.env.DEV) {
  window.addEventListener("load", () => {
    initAutoUpdater();
  });
}
