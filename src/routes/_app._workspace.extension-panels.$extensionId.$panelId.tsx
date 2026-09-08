import { createFileRoute } from "@tanstack/react-router";

import { ExtensionPanelRouteView } from "@/features/extensions/extension-panel-route-view";

export const Route = createFileRoute("/_app/_workspace/extension-panels/$extensionId/$panelId")({
  component: function ExtensionPanelRoute() {
    const { extensionId, panelId } = Route.useParams();
    return <ExtensionPanelRouteView extensionId={extensionId} panelId={panelId} />;
  },
});
