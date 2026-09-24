import { ChevronDown, Eye, LockKeyhole } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { CONNECTION_COLORS, type SavedConnection, type SshAuth } from "@/lib/connections";
import type { Capabilities, SslMode } from "@/lib/db";
import { cn } from "@/lib/utils";
import { ConnectionField } from "./connection-field";
import { SchemaPicker } from "./schema-picker";

interface Props {
  caps: Capabilities;
  defaultOpen: boolean;
  ssl: SslMode;
  onSsl: (value: SslMode) => void;
  readOnly: boolean;
  onReadOnly: (value: boolean) => void;
  sshEnabled: boolean;
  onSshEnabled: (value: boolean) => void;
  sshHost: string;
  onSshHost: (value: string) => void;
  sshPort: string;
  onSshPort: (value: string) => void;
  sshUser: string;
  onSshUser: (value: string) => void;
  sshAuth: SshAuth;
  onSshAuth: (value: SshAuth) => void;
  sshKey: string;
  onSshKey: (value: string) => void;
  sshPassword: string;
  onSshPassword: (value: string) => void;
  tags: string;
  onTags: (value: string) => void;
  color: string | null;
  onColor: (value: string | null) => void;
  schemaFilter: string[];
  onSchemaFilter: (value: string[]) => void;
  showSingleSchemaSwitcher: boolean;
  onShowSingleSchemaSwitcher: (value: boolean) => void;
  scannedSchemas: string[] | null;
  scannedUser: string;
  scanning: boolean;
  scanError: string | null;
  onScan: () => void;
  connection?: SavedConnection;
}

export function ConnectionAdvancedOptions({
  caps,
  defaultOpen,
  ssl,
  onSsl,
  readOnly,
  onReadOnly,
  sshEnabled,
  onSshEnabled,
  sshHost,
  onSshHost,
  sshPort,
  onSshPort,
  sshUser,
  onSshUser,
  sshAuth,
  onSshAuth,
  sshKey,
  onSshKey,
  sshPassword,
  onSshPassword,
  tags,
  onTags,
  color,
  onColor,
  schemaFilter,
  onSchemaFilter,
  showSingleSchemaSwitcher,
  onShowSingleSchemaSwitcher,
  scannedSchemas,
  scannedUser,
  scanning,
  scanError,
  onScan,
  connection,
}: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const showSecurity = caps.ssl || caps.ssh || caps.read_only_mode;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="rounded-xl border">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
        <span className="flex-1">Erweitert</span>
        <span className="text-[11px] font-normal text-muted-foreground">SSL, SSH, Farbe</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4 border-t px-3 py-3">
        {showSecurity && (
          <div className="grid gap-3 sm:grid-cols-2">
            {caps.ssl && (
              <div className="grid gap-1">
                <Label htmlFor="connection-ssl" className="text-xs text-muted-foreground">
                  SSL / TLS
                </Label>
                <Select value={ssl} onValueChange={(value) => onSsl(value as SslMode)}>
                  <SelectTrigger id="connection-ssl" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    <SelectItem value="prefer">Bevorzugen · für lokale Server</SelectItem>
                    <SelectItem value="require">
                      Erforderlich · System-Zertifikate prüfen
                    </SelectItem>
                    <SelectItem value="verify-full">Zertifikat und Hostname prüfen</SelectItem>
                    <SelectItem value="verify-ca">Zertifizierungsstelle prüfen</SelectItem>
                    <SelectItem value="disable">Deaktiviert</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {caps.ssh && (
              <label className="flex h-9 items-end justify-between gap-3 pb-0.5 text-xs font-medium sm:h-auto sm:items-center sm:self-end sm:pb-2">
                <span className="flex items-center gap-2">
                  <LockKeyhole className="size-4 text-muted-foreground" /> SSH-Tunnel
                </span>
                <Switch
                  checked={sshEnabled}
                  onCheckedChange={onSshEnabled}
                  aria-label="SSH-Tunnel"
                />
              </label>
            )}
            {caps.read_only_mode && (
              <label className="flex items-center justify-between gap-3 text-xs font-medium sm:col-span-2">
                <span className="flex flex-col gap-0.5">
                  <span className="flex items-center gap-2">
                    <Eye className="size-4 text-muted-foreground" /> Lesemodus
                  </span>
                  <span className="font-normal text-muted-foreground">
                    Schreibzugriffe werden serverseitig blockiert.
                  </span>
                </span>
                <Switch checked={readOnly} onCheckedChange={onReadOnly} aria-label="Lesemodus" />
              </label>
            )}
          </div>
        )}
        {caps.ssh && sshEnabled && (
          <div className="space-y-3 rounded-xl border p-3">
            <p className="text-xs text-muted-foreground">
              Der Datenbank-Host oben wird vom SSH-Server aus erreicht.
            </p>
            <div className="grid grid-cols-[1fr_80px] gap-3">
              <ConnectionField
                id="ssh-host"
                label="SSH-Host"
                value={sshHost}
                onChange={(event) => onSshHost(event.target.value)}
              />
              <ConnectionField
                id="ssh-port"
                label="SSH-Port"
                value={sshPort}
                onChange={(event) => onSshPort(event.target.value)}
              />
            </div>
            <ConnectionField
              id="ssh-user"
              label="SSH-Benutzer"
              value={sshUser}
              onChange={(event) => onSshUser(event.target.value)}
            />
            <div className="grid gap-2">
              <Label htmlFor="ssh-auth">Authentifizierung</Label>
              <Select value={sshAuth} onValueChange={(value) => onSshAuth(value as SshAuth)}>
                <SelectTrigger id="ssh-auth" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectItem value="key">SSH-Key</SelectItem>
                  <SelectItem value="password">Passwort</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {sshAuth === "key" && (
              <ConnectionField
                id="ssh-key"
                label="Absoluter Pfad zur Key-Datei"
                placeholder="/Users/name/.ssh/id_ed25519"
                value={sshKey}
                onChange={(event) => onSshKey(event.target.value)}
              />
            )}
            <ConnectionField
              id="ssh-password"
              label={sshAuth === "key" ? "Passphrase (optional)" : "SSH-Passwort"}
              type="password"
              value={sshPassword}
              placeholder={connection ? "Leer lassen, um gespeicherten Wert zu verwenden" : ""}
              onChange={(event) => onSshPassword(event.target.value)}
            />
          </div>
        )}
        <ConnectionField
          id="connection-tags"
          label="Tags"
          placeholder="Produktion, Team"
          value={tags}
          onChange={(event) => onTags(event.target.value)}
        />
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium">Profilfarbe</legend>
          <p className="text-xs text-muted-foreground">
            Kennzeichnet die Verbindung in der Oberfläche.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-label="Keine Farbe"
              aria-pressed={color === null}
              onClick={() => onColor(null)}
              className={`rounded-full border px-2.5 py-1 text-xs ${color === null ? "border-foreground bg-muted" : "border-border text-muted-foreground"}`}
            >
              Keine
            </button>
            {CONNECTION_COLORS.map((entry) => (
              <button
                key={entry.value}
                type="button"
                title={entry.label}
                aria-label={entry.label}
                aria-pressed={color === entry.value}
                onClick={() => onColor(entry.value)}
                className={`grid size-7 place-items-center rounded-full border-2 ${color === entry.value ? "border-foreground" : "border-transparent"}`}
              >
                <span className="size-5 rounded-full" style={{ backgroundColor: entry.value }} />
              </button>
            ))}
          </div>
        </fieldset>
        {caps.schemas && (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3 text-xs font-medium">
              <span>Schema-Auswahl bei nur einem Schema anzeigen</span>
              <Switch
                checked={showSingleSchemaSwitcher}
                onCheckedChange={onShowSingleSchemaSwitcher}
                aria-label="Schema-Auswahl bei nur einem Schema anzeigen"
              />
            </div>
            <SchemaPicker
              selected={schemaFilter}
              scanned={scannedSchemas}
              userName={scannedUser}
              scanning={scanning}
              error={scanError}
              onScan={onScan}
              onChange={onSchemaFilter}
            />
          </div>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
