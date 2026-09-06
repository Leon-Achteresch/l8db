import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import React from "react";
import ReactDOM from "react-dom/client";
import { StartupView } from "@/features/shell/startup-view";
import { initConnectionSecrets } from "@/lib/connections";
import { loadProviders } from "@/lib/providers";
import { restoreSshTunnel } from "@/lib/ssh";
import { checkForUpdates } from "@/lib/updater";
import { router } from "./router";

const queryClient = new QueryClient();

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(<StartupView />);

function render() {
  root.render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>,
  );
}

Promise.all([loadProviders(), initConnectionSecrets()])
  .then(restoreSshTunnel)
  .catch(() => undefined)
  .finally(render);

if (!import.meta.env.DEV) {
  window.addEventListener("load", () => {
    void checkForUpdates();
  });
}
