import { createFileRoute } from "@tanstack/react-router";

import { TableView } from "@/features/table/table-view";

export const Route = createFileRoute("/_app/tables/$schema/$table")({
  component: TableView,
  validateSearch: (
    search: Record<string, unknown>,
  ): { type?: "table" | "view"; fkFilter?: string } => ({
    type: search["type"] === "view" ? "view" : undefined,
    fkFilter: typeof search["fkFilter"] === "string" ? search["fkFilter"] : undefined,
  }),
});
