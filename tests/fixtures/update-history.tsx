import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { createRoot } from "react-dom/client";
import { UpdateVersionPicker } from "../../src/features/settings/update-version-picker";
import { UpdateAvailableDialog } from "../../src/features/updates/update-available-dialog";
import { useSettingsStore } from "../../src/lib/settings";
import "../../src/index.css";

const client = new QueryClient();
Object.assign(window, { updateHistoryClient: client, updateHistorySettings: useSettingsStore });

function UpdateHistoryFixture() {
  const channel = useSettingsStore((state) => state.updateChannel);
  return (
    <QueryClientProvider client={client}>
      <main className="@container mx-auto max-w-4xl p-8">
        <h1 className="mb-8 text-lg font-semibold">Über & Updates</h1>
        <div className="mb-6 flex gap-2">
          <button
            type="button"
            onClick={() => useSettingsStore.getState().setUpdateChannel("stable")}
          >
            Stable
          </button>
          <button
            type="button"
            onClick={() => useSettingsStore.getState().setUpdateChannel("canary")}
          >
            Canary
          </button>
        </div>
        <UpdateVersionPicker key={channel} channel={channel} currentVersion="0.18.0-canary.100" />
        <UpdateAvailableDialog />
      </main>
    </QueryClientProvider>
  );
}

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
const router = createRouter({
  routeTree: createRootRoute({ component: UpdateHistoryFixture }),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
createRoot(root).render(<RouterProvider router={router} />);
