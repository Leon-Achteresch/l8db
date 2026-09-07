import { createFileRoute } from "@tanstack/react-router";

import { TriggerView } from "@/features/triggers/trigger-view";

export const Route = createFileRoute("/_app/_workspace/triggers/$schema/$table/$trigger")({
  component: function TriggerRoute() {
    const { schema, table, trigger } = Route.useParams();
    return <TriggerView schema={schema} table={table} trigger={trigger} />;
  },
});
