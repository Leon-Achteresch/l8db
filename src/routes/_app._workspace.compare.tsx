import { createFileRoute } from "@tanstack/react-router";

import { CompareView } from "@/features/compare/compare-view";

export const Route = createFileRoute("/_app/_workspace/compare")({
  component: CompareView,
});
