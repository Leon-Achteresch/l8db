import { createFileRoute } from "@tanstack/react-router";

import { TableColumnHighlight } from "@/features/objects/table-column-highlight";
import { TableView } from "@/features/table/table-view";

export const Route = createFileRoute("/_app/_workspace/tables/$schema/$table")({
  component: function TableRoute() {
    const { column } = Route.useSearch();
    return (
      <>
        <TableColumnHighlight column={column} />
        <TableView />
      </>
    );
  },
  validateSearch: (
    search: Record<string, unknown>,
  ): { type?: "table" | "view"; fkFilter?: string; fkRaw?: boolean; column?: string } => ({
    type: search["type"] === "view" ? "view" : undefined,
    fkFilter: typeof search["fkFilter"] === "string" ? search["fkFilter"] : undefined,
    fkRaw: search["fkRaw"] === true ? true : undefined,
    column: typeof search["column"] === "string" ? search["column"] : undefined,
  }),
});
