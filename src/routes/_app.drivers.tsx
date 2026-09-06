import { createFileRoute } from "@tanstack/react-router";

import { DriversView } from "@/features/drivers/drivers-view";

export const Route = createFileRoute("/_app/drivers")({
  component: DriversView,
});
