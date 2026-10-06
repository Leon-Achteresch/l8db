import { createFileRoute } from "@tanstack/react-router";

import { HealthView } from "@/features/health/health-view";

export const Route = createFileRoute("/_app/_workspace/health")({
  component: HealthView,
});
