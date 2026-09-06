import { createFileRoute } from "@tanstack/react-router";

import { ErDiagramView } from "@/features/er-diagram/er-diagram-view";

export const Route = createFileRoute("/_app/_workspace/er-diagram")({
  component: ErDiagramView,
});
