import { createFileRoute } from "@tanstack/react-router";
import { InvalidObjectsView } from "@/features/invalid-objects/invalid-objects-view";

export const Route = createFileRoute("/_app/_workspace/invalid-objects")({
  component: InvalidObjectsView,
});
