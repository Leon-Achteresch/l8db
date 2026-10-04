import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { COMMAND_TUNNEL_PRESETS } from "@/lib/ssh";
import { ConnectionField } from "../connection-field";
import type { NetworkDraft } from "./use-network-draft";

export function CommandTunnelFields({ network }: { network: NetworkDraft }) {
  return (
    <div className="space-y-3 rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">
        Der Befehl wird beim Verbinden in deiner Login-Shell gestartet und muss die Datenbank auf
        127.0.0.1:{"{localPort}"} bereitstellen. l8db wählt einen freien Port, setzt ihn für{" "}
        {"{localPort}"} ein und beendet den Prozess beim Trennen.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {COMMAND_TUNNEL_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => network.setCommandTemplate(preset.template)}
            className="h-7 rounded-full border bg-card px-3 text-xs font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {preset.label}
          </button>
        ))}
      </div>
      <div className="grid gap-2">
        <Label htmlFor="command-tunnel-template">Befehl</Label>
        <Textarea
          id="command-tunnel-template"
          value={network.commandTemplate}
          spellCheck={false}
          autoComplete="off"
          className="min-h-16 font-mono text-xs"
          placeholder="kubectl port-forward svc/postgres {localPort}:5432"
          onChange={(event) => network.setCommandTemplate(event.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ConnectionField
          id="command-tunnel-port"
          label="Fester lokaler Port (optional)"
          value={network.commandLocalPort}
          placeholder="automatisch"
          onChange={(event) => network.setCommandLocalPort(event.target.value)}
        />
        <ConnectionField
          id="command-tunnel-timeout"
          label="Zeitlimit (Sekunden)"
          value={network.commandTimeout}
          onChange={(event) => network.setCommandTimeout(event.target.value)}
        />
      </div>
    </div>
  );
}
