import { createFileRoute } from "@tanstack/react-router";

import { SettingsView } from "@/features/settings/settings-view";

export const Route = createFileRoute("/settings")({
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: SettingsView,
});
