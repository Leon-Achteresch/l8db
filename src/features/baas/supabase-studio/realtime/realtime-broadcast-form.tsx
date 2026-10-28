import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { supabaseRealtimeBroadcast, supabaseRealtimePush } from "@/lib/db/supabase-studio-edge";

export function RealtimeBroadcastForm({
  reference,
  session,
  channel,
  isPrivate,
}: {
  reference: string;
  session: string | null;
  channel: string;
  isPrivate: boolean;
}) {
  const [target, setTarget] = useState(channel);
  const topic = session ? channel : target.trim();
  const [event, setEvent] = useState("message");
  const [payload, setPayload] = useState('{\n  "text": "Hallo"\n}');
  const [viaRest, setViaRest] = useState(false);
  const rest = viaRest || !session;
  const send = useMutation({
    mutationFn: () => {
      const body = JSON.parse(payload);
      return rest
        ? supabaseRealtimeBroadcast(reference, topic, event.trim(), body, isPrivate)
        : supabaseRealtimePush(session as string, "broadcast", event.trim(), body);
    },
  });

  return (
    <form
      className="space-y-2 rounded-xl border p-3"
      onSubmit={(formEvent) => {
        formEvent.preventDefault();
        send.mutate();
      }}
    >
      <p className="text-xs font-medium">Broadcast senden</p>
      {!session && (
        <div className="grid gap-1.5">
          <Label htmlFor="realtime-broadcast-channel">Kanal (REST)</Label>
          <Input
            id="realtime-broadcast-channel"
            className="h-8 font-mono text-xs"
            value={target}
            onChange={(change) => setTarget(change.target.value)}
          />
        </div>
      )}
      <div className="grid gap-1.5">
        <Label htmlFor="realtime-broadcast-event">Event</Label>
        <Input
          id="realtime-broadcast-event"
          className="h-8 font-mono text-xs"
          value={event}
          onChange={(change) => setEvent(change.target.value)}
        />
      </div>
      <Textarea
        className="min-h-24 font-mono text-xs"
        value={payload}
        onChange={(change) => setPayload(change.target.value)}
        aria-label="Broadcast-Payload (JSON)"
      />
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2 text-xs">
          <Switch
            id="realtime-broadcast-rest"
            checked={rest}
            disabled={!session}
            onCheckedChange={setViaRest}
          />
          <Label htmlFor="realtime-broadcast-rest">Über REST-API senden</Label>
        </div>
        <Button
          size="sm"
          type="submit"
          className="ml-auto"
          disabled={!event.trim() || !topic || send.isPending}
        >
          <Send className="size-3.5" /> Senden
        </Button>
      </div>
      {send.isError && (
        <p role="alert" className="text-xs text-destructive">
          {send.error instanceof Error ? send.error.message : String(send.error)}
        </p>
      )}
      {send.isSuccess && <p className="text-xs text-muted-foreground">Gesendet.</p>}
    </form>
  );
}
