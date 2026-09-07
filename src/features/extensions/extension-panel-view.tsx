import { useEffect, useRef } from "react";
import { useExtensionHost, useExtensionPanels } from "@/lib/extensions/react-context";
import type { Json } from "@/lib/extensions/contracts";

export function ExtensionPanelView({
  extensionId,
  panelId,
}: {
  extensionId: string;
  panelId: string;
}) {
  const host = useExtensionHost();
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const snapshot = useExtensionPanels().find(
    (p) => p.extensionId === extensionId && p.panelId === panelId,
  );

  useEffect(() => {
    const subscription = host.panels.outgoing.on(`${extensionId}:${panelId}`, (message) => {
      frameRef.current?.contentWindow?.postMessage(
        { source: "l8db-extension", message },
        "*",
      );
    });
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const data = event.data as { source?: string; message?: Json };
      if (!data || data.source !== "l8db-webview") return;
      host.panelMessageFromWebview(extensionId, panelId, data.message ?? null);
    };
    window.addEventListener("message", onMessage);
    return () => {
      subscription.dispose();
      window.removeEventListener("message", onMessage);
    };
  }, [host, extensionId, panelId]);

  if (!snapshot) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 bg-background">
        <p className="text-sm text-muted-foreground font-medium">Panel nicht verfügbar.</p>
      </div>
    );
  }
  return (
    <iframe
      ref={frameRef}
      title={snapshot.title}
      sandbox="allow-scripts"
      srcDoc={snapshot.html}
      className="size-full min-h-0 flex-1 border-0 bg-background"
    />
  );
}
