import { createFileRoute } from "@tanstack/react-router";

import { SavedPlanView } from "@/features/explain/saved-plan-view";

export const Route = createFileRoute("/_app/_workspace/saved-plan")({
  component: SavedPlanView,
});
