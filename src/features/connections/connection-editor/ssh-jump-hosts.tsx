import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ConnectionField } from "../connection-field";
import { SshAuthFields } from "./ssh-auth-fields";
import type { NetworkDraft } from "./use-network-draft";

export function SshJumpHosts({ network }: { network: NetworkDraft }) {
  const { jumpHosts, addJumpHost, updateJumpHost, removeJumpHost, moveJumpHost } = network;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-medium">Sprung-Hosts (ProxyJump)</p>
          <p className="text-[11px] text-muted-foreground">
            Werden in dieser Reihenfolge vor dem SSH-Server durchlaufen.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" className="h-7" onClick={addJumpHost}>
          <Plus className="size-3.5" /> Hinzufügen
        </Button>
      </div>
      {jumpHosts.map((jump, index) => (
        <div key={jump.key} className="space-y-3 rounded-lg border border-dashed p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium">Sprung-Host {index + 1}</p>
            <div className="flex gap-1">
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`Sprung-Host ${index + 1} nach oben`}
                disabled={index === 0}
                onClick={() => moveJumpHost(jump.key, -1)}
              >
                <ArrowUp className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`Sprung-Host ${index + 1} nach unten`}
                disabled={index === jumpHosts.length - 1}
                onClick={() => moveJumpHost(jump.key, 1)}
              >
                <ArrowDown className="size-3.5" />
              </Button>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-7"
                aria-label={`Sprung-Host ${index + 1} entfernen`}
                onClick={() => removeJumpHost(jump.key)}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-[1fr_80px] gap-3">
            <ConnectionField
              id={`jump-${jump.key}-host`}
              label="Host"
              value={jump.host}
              onChange={(event) => updateJumpHost(jump.key, { host: event.target.value })}
            />
            <ConnectionField
              id={`jump-${jump.key}-port`}
              label="Port"
              value={jump.port}
              onChange={(event) => updateJumpHost(jump.key, { port: event.target.value })}
            />
          </div>
          <ConnectionField
            id={`jump-${jump.key}-user`}
            label="Benutzer"
            value={jump.user}
            onChange={(event) => updateJumpHost(jump.key, { user: event.target.value })}
          />
          <SshAuthFields
            idPrefix={`jump-${jump.key}`}
            auth={jump.auth}
            onAuth={(auth) => updateJumpHost(jump.key, { auth })}
            keyFile={jump.keyFile}
            onKeyFile={(keyFile) => updateJumpHost(jump.key, { keyFile })}
            agentSocket={jump.agentSocket}
            onAgentSocket={(agentSocket) => updateJumpHost(jump.key, { agentSocket })}
            secret={jump.secret}
            onSecret={(secret) => updateJumpHost(jump.key, { secret })}
          />
        </div>
      ))}
    </div>
  );
}
