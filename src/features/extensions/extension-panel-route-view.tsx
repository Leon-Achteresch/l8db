import { useEffect } from "react";
import { ExtensionPanelView } from "@/features/extensions/extension-panel-view";
import { useExtensionPanels } from "@/lib/extensions/react-context";
import { useTableTabs } from "@/lib/table-tabs";

export function ExtensionPanelRouteView({
  extensionId,
  panelId,
}: {
  extensionId: string;
  panelId: string;
}) {
  const openExtensionPanel = useTableTabs((state) => state.openExtensionPanel);
  const snapshot = useExtensionPanels().find(
    (panel) => panel.extensionId === extensionId && panel.panelId === panelId,
  );

  useEffect(() => {
    openExtensionPanel({
      extensionId,
      panelId,
      title: snapshot?.title ?? panelId,
    });
  }, [extensionId, panelId, snapshot?.title, openExtensionPanel]);

  return <ExtensionPanelView extensionId={extensionId} panelId={panelId} />;
}
