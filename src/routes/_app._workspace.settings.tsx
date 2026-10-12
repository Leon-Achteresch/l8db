import { createFileRoute } from "@tanstack/react-router";

import { SettingsView } from "@/features/settings/settings-view";

export const Route = createFileRoute("/_app/_workspace/settings")({
  validateSearch: (search: Record<string, unknown>): { tab?: string; setting?: string } => ({
    setting: typeof search.setting === "string" ? search.setting : undefined,
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: SettingsView,
});
