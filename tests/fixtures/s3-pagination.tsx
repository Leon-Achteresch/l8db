import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { mockIPC } from "@tauri-apps/api/mocks";
import { createRoot } from "react-dom/client";
import { ObjectBrowser } from "../../src/features/storage/object-browser";
import { useConnectionsStore } from "../../src/lib/connections";
import "../../src/index.css";

let calls = 0;
mockIPC((cmd) => {
  if (cmd !== "s3_list_objects") return null;
  calls++;
  if (calls === 2) throw new Error("Verbindung unterbrochen");
  return {
    prefixes: [calls === 1 ? "Erster/" : "Zweiter/"],
    objects: [],
    next_token: "same",
    truncated: true,
  };
});
useConnectionsStore.setState({
  connections: [
    {
      id: "s3-test",
      kind: "s3",
      name: "Test",
      sslMode: "disable",
      connectionString: "s3://test",
      temporary: true,
    },
  ],
  activeId: "s3-test",
});
const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <ObjectBrowser bucket="bucket" scope="s3-test" active={false} />
    </QueryClientProvider>,
  );
