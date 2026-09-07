import { createFileRoute } from "@tanstack/react-router";

import { AlterTableView } from "@/features/alter-table/alter-table-view";

export const Route = createFileRoute("/_app/_workspace/alter-table/$schema/$table")({
  component: function AlterTableRoute() {
    const { schema, table } = Route.useParams();
    return <AlterTableView schema={schema} table={table} />;
  },
});
