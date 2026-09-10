import { createFileRoute } from "@tanstack/react-router";

import { QueryView } from "@/features/query/query-view";

export const Route = createFileRoute("/_app/query/$id")({
  component: function QueryTabRoute() {
    const { id } = Route.useParams();
    return <QueryView tabId={id} />;
  },
});
