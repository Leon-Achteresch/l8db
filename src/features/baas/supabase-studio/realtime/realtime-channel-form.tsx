import { Plug, Plus, Unplug, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { SupabaseRealtimeChange } from "@/lib/db/supabase-studio-edge";
import type { RealtimeConfig } from "./use-realtime-session";

const EVENTS: SupabaseRealtimeChange["event"][] = ["*", "INSERT", "UPDATE", "DELETE"];
const MAX_CHANGES = 20;

export function RealtimeChannelForm({
  connected,
  busy,
  onStart,
  onStop,
}: {
  connected: boolean;
  busy: boolean;
  onStart: (config: RealtimeConfig) => void;
  onStop: () => void;
}) {
  const [channel, setChannel] = useState("l8db-inspector");
  const [isPrivate, setPrivate] = useState(false);
  const [presenceKey, setPresenceKey] = useState("l8db");
  const [changes, setChanges] = useState<(SupabaseRealtimeChange & { key: string })[]>([
    { key: crypto.randomUUID(), event: "*", schema: "public", table: "", filter: "" },
  ]);
  const locked = connected || busy;
  const update = (index: number, patch: Partial<SupabaseRealtimeChange>) =>
    setChanges((items) => items.map((item, at) => (at === index ? { ...item, ...patch } : item)));

  return (
    <form
      className="space-y-3 rounded-xl border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (connected || busy) {
          onStop();
          return;
        }
        onStart({
          channel: channel.trim(),
          isPrivate,
          presenceKey: presenceKey.trim(),
          changes: changes
            .filter((change) => change.schema.trim())
            .map((change) => ({
              event: change.event,
              schema: change.schema.trim(),
              table: change.table?.trim() || null,
              filter: change.filter?.trim() || null,
            })),
        });
      }}
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="grid min-w-48 flex-1 gap-1.5">
          <Label htmlFor="realtime-channel">Kanal</Label>
          <Input
            id="realtime-channel"
            className="h-8 font-mono text-xs"
            value={channel}
            disabled={locked}
            onChange={(event) => setChannel(event.target.value)}
          />
        </div>
        <div className="grid w-40 gap-1.5">
          <Label htmlFor="realtime-presence-key">Presence-Key</Label>
          <Input
            id="realtime-presence-key"
            className="h-8 text-xs"
            value={presenceKey}
            disabled={locked}
            onChange={(event) => setPresenceKey(event.target.value)}
          />
        </div>
        <div className="flex h-8 items-center gap-2 text-xs">
          <Switch
            id="realtime-private"
            checked={isPrivate}
            disabled={locked}
            onCheckedChange={setPrivate}
          />
          <Label htmlFor="realtime-private">Privat (RLS)</Label>
        </div>
        <Button
          size="sm"
          type="submit"
          variant={connected || busy ? "outline" : "default"}
          disabled={!channel.trim()}
        >
          {connected || busy ? (
            <>
              <Unplug className="size-3.5" /> Trennen
            </>
          ) : (
            <>
              <Plug className="size-3.5" /> Verbinden
            </>
          )}
        </Button>
      </div>
      <div className="space-y-1.5">
        <p className="text-xs font-medium">Postgres-Änderungen</p>
        {changes.map((change, index) => (
          <div key={change.key} className="flex flex-wrap items-center gap-2">
            <Select
              value={change.event}
              disabled={locked}
              onValueChange={(value) =>
                update(index, { event: value as SupabaseRealtimeChange["event"] })
              }
            >
              <SelectTrigger size="sm" className="h-8 w-28 text-xs" aria-label="Event">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EVENTS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item === "*" ? "Alle" : item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="h-8 w-32 font-mono text-xs"
              value={change.schema}
              disabled={locked}
              onChange={(event) => update(index, { schema: event.target.value })}
              aria-label="Schema"
              placeholder="public"
            />
            <Input
              className="h-8 w-40 font-mono text-xs"
              value={change.table ?? ""}
              disabled={locked}
              onChange={(event) => update(index, { table: event.target.value })}
              aria-label="Tabelle"
              placeholder="Alle Tabellen"
            />
            <Input
              className="h-8 min-w-40 flex-1 font-mono text-xs"
              value={change.filter ?? ""}
              disabled={locked}
              onChange={(event) => update(index, { filter: event.target.value })}
              aria-label="Filter"
              placeholder="Filter, z. B. id=eq.1"
            />
            <Button
              size="icon-xs"
              variant="ghost"
              type="button"
              disabled={locked}
              aria-label="Filter entfernen"
              onClick={() => setChanges((items) => items.filter((_, at) => at !== index))}
            >
              <X className="size-3" />
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="ghost"
          type="button"
          disabled={locked || changes.length >= MAX_CHANGES}
          onClick={() =>
            setChanges((items) => [
              ...items,
              { key: crypto.randomUUID(), event: "*", schema: "public", table: "", filter: "" },
            ])
          }
        >
          <Plus className="size-3.5" /> Filter hinzufügen
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Änderungen kommen nur für Tabellen an, die in der Publikation supabase_realtime sind. Ohne
          Filter empfängt der Kanal nur Broadcast und Presence.
        </p>
      </div>
    </form>
  );
}
