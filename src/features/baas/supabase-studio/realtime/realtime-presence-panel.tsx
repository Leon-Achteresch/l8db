import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabaseRealtimePush } from "@/lib/db/supabase-studio-edge";
import type { PresenceState } from "./realtime-presence";

export function RealtimePresencePanel({
  session,
  presence,
}: {
  session: string | null;
  presence: PresenceState;
}) {
  const [payload, setPayload] = useState('{\n  "status": "online"\n}');
  const push = useMutation({
    mutationFn: (kind: "track" | "untrack") =>
      supabaseRealtimePush(
        session as string,
        kind,
        "",
        kind === "track" ? JSON.parse(payload) : {},
      ),
  });
  const keys = Object.keys(presence);

  return (
    <div className="space-y-2 rounded-xl border p-3">
      <p className="text-xs font-medium">Presence ({keys.length})</p>
      <Textarea
        className="min-h-20 font-mono text-xs"
        value={payload}
        onChange={(event) => setPayload(event.target.value)}
        aria-label="Presence-Payload (JSON)"
      />
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={!session || push.isPending}
          title={session ? undefined : "Zuerst verbinden."}
          onClick={() => push.mutate("track")}
        >
          Track
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!session || push.isPending}
          onClick={() => push.mutate("untrack")}
        >
          Untrack
        </Button>
      </div>
      {push.isError && (
        <p role="alert" className="text-xs text-destructive">
          {push.error instanceof Error ? push.error.message : String(push.error)}
        </p>
      )}
      <pre className="max-h-48 overflow-auto rounded-lg bg-muted/30 p-2 font-mono text-[11px]">
        {keys.length ? JSON.stringify(presence, null, 2) : "Niemand anwesend."}
      </pre>
    </div>
  );
}
