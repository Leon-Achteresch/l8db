import { createFileRoute } from "@tanstack/react-router";

import { TableView } from "@/features/table/table-view";

export const Route = createFileRoute("/_app/_workspace/tables/$schema/$table")({
  component: TableView,
  validateSearch: (
    search: Record<string, unknown>,
  ): { type?: "table" | "view"; fkFilter?: string; fkRaw?: boolean } => ({
    type: search["type"] === "view" ? "view" : undefined,
    fkFilter: typeof search["fkFilter"] === "string" ? search["fkFilter"] : undefined,
    fkRaw: search["fkRaw"] === true ? true : undefined,
  }),
});
