import { createFileRoute } from "@tanstack/react-router";

import { ImportView } from "@/features/import/import-view";

export const Route = createFileRoute("/_app/_workspace/import")({
  validateSearch: (search: Record<string, unknown>): { tab?: "csv" } =>
    search.tab === "csv" ? { tab: "csv" } : {},
  component: ImportView,
});
