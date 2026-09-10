import { createFileRoute } from "@tanstack/react-router";

import { ExtensionPage } from "@/pages/ExtensionPage";

export const Route = createFileRoute("/_app/extensions/$name")({
  component: ExtensionPage,
});
