import { createFileRoute } from "@tanstack/react-router";

import { QueryBuilderView } from "@/features/query-builder/query-builder-view";

export const Route = createFileRoute("/_app/_workspace/query-builder")({
  component: QueryBuilderView,
});
