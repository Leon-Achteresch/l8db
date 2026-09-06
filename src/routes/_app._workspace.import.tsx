import { createFileRoute } from "@tanstack/react-router";

import { ImportView } from "@/features/import/import-view";

export const Route = createFileRoute("/_app/_workspace/import")({
  component: ImportView,
});
