import { createFileRoute } from "@tanstack/react-router";

import { ExtensionView } from "@/features/extensions/extension-view";

export const Route = createFileRoute("/_app/extensions/$name")({
  component: ExtensionView,
});
