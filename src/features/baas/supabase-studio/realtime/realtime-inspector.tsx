import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { RealtimeBroadcastForm } from "./realtime-broadcast-form";
import { RealtimeChannelForm } from "./realtime-channel-form";
import { RealtimeMessageList } from "./realtime-message-list";
import { RealtimePresencePanel } from "./realtime-presence-panel";
import { type RealtimeConfig, useRealtimeSession } from "./use-realtime-session";

const STATUS_LABEL = {
  idle: "Nicht verbunden",
  connecting: "Verbindet…",
  open: "Verbunden",
  closed: "Getrennt",
};

export function RealtimeInspector({ reference }: { reference: string }) {
  const realtime = useRealtimeSession(reference);
  const [config, setConfig] = useState<RealtimeConfig | null>(null);
  const connected = realtime.status === "open";

  return (
    <div className="space-y-3">
      <RealtimeChannelForm
        connected={connected}
        busy={realtime.status === "connecting"}
        onStart={(next) => {
          setConfig(next);
          realtime.start(next);
        }}
        onStop={realtime.stop}
      />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={connected ? "secondary" : "outline"}>{STATUS_LABEL[realtime.status]}</Badge>
        {config && realtime.status !== "idle" && (
          <span className="font-mono text-muted-foreground">realtime:{config.channel}</span>
        )}
        {realtime.error && (
          <span role="alert" className="text-destructive">
            {realtime.error}
          </span>
        )}
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <RealtimeMessageList
          messages={realtime.messages}
          paused={realtime.paused}
          skipped={realtime.skipped}
          onPause={realtime.setPaused}
          onClear={realtime.clear}
        />
        <div className="space-y-3">
          <RealtimeBroadcastForm
            reference={reference}
            session={connected ? realtime.session : null}
            channel={config?.channel ?? "l8db-inspector"}
            isPrivate={config?.isPrivate ?? false}
          />
          <RealtimePresencePanel
            session={connected ? realtime.session : null}
            presence={realtime.presence}
          />
        </div>
      </div>
    </div>
  );
}
