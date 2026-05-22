import { createFileRoute } from "@tanstack/react-router";

import { TablePage } from "@/pages/TablePage";

export const Route = createFileRoute("/_app/tables/$schema/$table")({
  component: TablePage,
  validateSearch: (
    search: Record<string, unknown>,
  ): { type?: "table" | "view" } => ({
    type: search["type"] === "view" ? "view" : undefined,
  }),
});
