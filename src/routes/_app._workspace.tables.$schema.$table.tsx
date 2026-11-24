import { createFileRoute } from "@tanstack/react-router";

import { TableView } from "@/features/table/table-view";

export const Route = createFileRoute("/_app/_workspace/tables/$schema/$table")({
  component: function TableRoute() {
    const { schema, table } = Route.useParams();
    const { type, fkFilter, fkRaw, fkSort, fkSortDesc, column } = Route.useSearch();
    return (
      <TableView
        schema={schema}
        table={table}
        type={type}
        fkFilter={fkFilter}
        fkRaw={fkRaw}
        fkSort={fkSort}
        fkSortDesc={fkSortDesc}
        column={column}
      />
    );
  },
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    type?: "table" | "view";
    fkFilter?: string;
    fkRaw?: boolean;
    fkSort?: string;
    fkSortDesc?: boolean;
    column?: string;
  } => ({
    type: search.type === "view" ? "view" : undefined,
    fkFilter: typeof search.fkFilter === "string" ? search.fkFilter : undefined,
    fkRaw: search.fkRaw === true ? true : undefined,
    fkSort: typeof search.fkSort === "string" && search.fkSort ? search.fkSort : undefined,
    fkSortDesc: search.fkSortDesc === true ? true : undefined,
    column: typeof search.column === "string" ? search.column : undefined,
  }),
});
