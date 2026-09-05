import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { router } from "./router";
import { initConnectionSecrets } from "@/lib/connections";
import { restoreSshTunnel } from "@/lib/ssh";

const queryClient = new QueryClient();

function render() {
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </React.StrictMode>,
  );
  void restoreSshTunnel().catch(() => undefined);
}

initConnectionSecrets()
  .catch(() => undefined)
  .finally(render);
