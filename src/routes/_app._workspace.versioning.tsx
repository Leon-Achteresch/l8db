import { createFileRoute } from "@tanstack/react-router";
import { VersioningRouteView } from "@/features/versioning/versioning-route-view";

export const Route = createFileRoute("/_app/_workspace/versioning")({
  component: VersioningRouteView,
});
