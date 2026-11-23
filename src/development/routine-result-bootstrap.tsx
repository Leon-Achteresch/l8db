import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { confirmRoutineResultFixture } from "@/lib/db/routine-result-development";

export async function startRoutineResultDevelopment() {
  await confirmRoutineResultFixture();
  const { RoutineResultDevelopment } = await import("./routine-result-development");
  const root = document.getElementById("root");
  if (!root) throw Error("Routinenfenster fehlt.");
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false } } });
  createRoot(root).render(
    createElement(QueryClientProvider, { client }, createElement(RoutineResultDevelopment)),
  );
}
