import { createFileRoute } from "@tanstack/react-router";

import { TeamSetupView } from "@/features/team-setup/team-setup-view";

export const Route = createFileRoute("/_app/_workspace/team-setup")({
  component: TeamSetupView,
});
