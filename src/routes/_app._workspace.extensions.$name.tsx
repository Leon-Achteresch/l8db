import { createFileRoute } from "@tanstack/react-router";

import { ExtensionView } from "@/features/extensions/extension-view";

export const Route = createFileRoute("/_app/_workspace/extensions/$name")({
  component: function ExtensionRoute() {
    const { name } = Route.useParams();
    return <ExtensionView name={name} />;
  },
});
