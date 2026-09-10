import { createFileRoute } from "@tanstack/react-router";

import { QueryPage } from "@/pages/QueryPage";

export const Route = createFileRoute("/_app/query/$id")({
  component: function QueryTab() {
    const { id } = Route.useParams();
    return <QueryPage tabId={id} />;
  },
});
