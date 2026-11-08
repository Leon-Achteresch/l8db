import { createFileRoute } from "@tanstack/react-router";

import { DiscoverView } from "@/features/discovery/discover-view";

export const Route = createFileRoute("/_app/_workspace/discover")({
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
    tab: typeof search.tab === "string" ? search.tab : undefined,
  }),
  component: DiscoverView,
});
