import { createFileRoute } from "@tanstack/react-router";

import { AvailableExtensionsView } from "@/features/extensions/extensions-list-view";

export const Route = createFileRoute("/_app/available-extensions")({
  component: AvailableExtensionsView,
});
