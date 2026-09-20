import { createFileRoute } from "@tanstack/react-router";
import { VersioningView } from "@/features/versioning/versioning-view";

export const Route = createFileRoute("/_app/_workspace/versioning")({
  component: VersioningView,
});
