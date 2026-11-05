import { HotkeysProvider } from "@tanstack/react-hotkeys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { createRoot } from "react-dom/client";
import { FederationView } from "../src/features/federation/federation-view";
import { useConnectionsStore } from "../src/lib/connections";
import "../src/index.css";

useConnectionsStore.setState({
  activeId: null,
  connections: [
    {
      id: "crm",
      name: "CRM",
      kind: "postgres",
      connectionString: "postgresql://localhost/crm",
      sslMode: "disable",
    },
    {
      id: "sales",
      name: "Sales",
      kind: "mysql",
      connectionString: "mysql://localhost/sales",
      sslMode: "disable",
    },
  ],
});
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});
const root = createRoot(document.getElementById("root")!);
Object.assign(window, { __federationUnmount: () => root.unmount() });
root.render(
  <ThemeProvider attribute="class" defaultTheme="dark">
    <HotkeysProvider>
      <QueryClientProvider client={client}>
        <FederationView />
      </QueryClientProvider>
    </HotkeysProvider>
  </ThemeProvider>,
);
