import { createFileRoute } from "@tanstack/react-router";

import { AutomationView } from "@/features/automation/automation-view";

export const Route = createFileRoute("/_app/_workspace/automation")({
  component: AutomationView,
});
