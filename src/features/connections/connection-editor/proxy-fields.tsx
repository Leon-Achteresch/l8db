import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProxyType, SavedConnection } from "@/lib/connections";
import { ConnectionField } from "../connection-field";
import type { NetworkDraft } from "./use-network-draft";

export function ProxyFields({
  network,
  sshEnabled,
  connection,
}: {
  network: NetworkDraft;
  sshEnabled: boolean;
  connection?: SavedConnection;
}) {
  return (
    <div className="space-y-3 rounded-xl border p-3">
      <p className="text-xs text-muted-foreground">
        {sshEnabled
          ? "Der SSH-Server bzw. der erste Sprung-Host wird über den Proxy erreicht."
          : "Die Datenbank wird über einen lokalen Weiterleitungsport durch den Proxy erreicht."}
      </p>
      <div className="grid gap-2">
        <Label htmlFor="proxy-type">Proxy-Typ</Label>
        <Select
          value={network.proxyType}
          onValueChange={(value) => value && network.setProxyType(value as ProxyType)}
        >
          <SelectTrigger id="proxy-type" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="socks5">SOCKS5</SelectItem>
            <SelectItem value="http">HTTP CONNECT</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-[1fr_80px] gap-3">
        <ConnectionField
          id="proxy-host"
          label="Proxy-Host"
          value={network.proxyHost}
          onChange={(event) => network.setProxyHost(event.target.value)}
        />
        <ConnectionField
          id="proxy-port"
          label="Port"
          value={network.proxyPort}
          onChange={(event) => network.setProxyPort(event.target.value)}
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ConnectionField
          id="proxy-user"
          label="Benutzer (optional)"
          value={network.proxyUser}
          autoComplete="off"
          onChange={(event) => network.setProxyUser(event.target.value)}
        />
        <ConnectionField
          id="proxy-password"
          label="Passwort (optional)"
          type="password"
          value={network.proxyPassword}
          placeholder={connection?.proxy?.username ? "Gespeicherten Wert verwenden" : ""}
          onChange={(event) => network.setProxyPassword(event.target.value)}
        />
      </div>
    </div>
  );
}
