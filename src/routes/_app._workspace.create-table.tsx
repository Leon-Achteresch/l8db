import { createFileRoute } from "@tanstack/react-router";

import { CreateObjectView } from "@/features/tables/create-object-view";

export const Route = createFileRoute("/_app/_workspace/create-table")({
  component: CreateObjectView,
});
