import { createFileRoute } from "@tanstack/react-router";

import { MatviewView } from "@/features/matviews/matview-view";

export const Route = createFileRoute("/_app/_workspace/matviews/$schema/$name")({
  component: function MatviewRoute() {
    const { schema, name } = Route.useParams();
    return <MatviewView schema={schema} name={name} />;
  },
});
