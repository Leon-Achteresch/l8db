import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { JdbcManager } from "@/features/drivers/jdbc-manager";
import "@/index.css";

const root = document.getElementById("root");
if (!root) throw new Error("Fixture root missing");
createRoot(root).render(
  <QueryClientProvider client={new QueryClient()}>
    <main className="mx-auto max-w-5xl p-6">
      <JdbcManager />
    </main>
  </QueryClientProvider>,
);
