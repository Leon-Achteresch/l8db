import { createFileRoute } from "@tanstack/react-router";

import { CreateTableView } from "@/features/tables/create-table-view";

export const Route = createFileRoute("/_app/_workspace/create-table")({
  component: CreateTableView,
});
