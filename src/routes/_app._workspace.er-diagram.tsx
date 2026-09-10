import { createFileRoute } from "@tanstack/react-router";

import { ErDiagramView } from "@/features/er-diagram/er-diagram-view";

export const Route = createFileRoute("/_app/er-diagram")({
  component: ErDiagramView,
});
