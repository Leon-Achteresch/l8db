import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SshAuth } from "@/lib/connections";
import { onePasswordAgentSocket } from "@/lib/ssh";
import { ConnectionField } from "../connection-field";

interface Props {
  idPrefix: string;
  auth: SshAuth;
  onAuth: (value: SshAuth) => void;
  keyFile: string;
  onKeyFile: (value: string) => void;
  agentSocket: string;
  onAgentSocket: (value: string) => void;
  secret: string;
  onSecret: (value: string) => void;
  secretPlaceholder?: string;
}

export function SshAuthFields({
  idPrefix,
  auth,
  onAuth,
  keyFile,
  onKeyFile,
  agentSocket,
  onAgentSocket,
  secret,
  onSecret,
  secretPlaceholder,
}: Props) {
  const onePassword = onePasswordAgentSocket();
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor={`${idPrefix}-auth`}>Authentifizierung</Label>
        <Select value={auth} onValueChange={(value) => value && onAuth(value as SshAuth)}>
          <SelectTrigger id={`${idPrefix}-auth`} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="agent">SSH-Agent</SelectItem>
            <SelectItem value="key">SSH-Key</SelectItem>
            <SelectItem value="password">Passwort</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {auth === "key" && (
        <ConnectionField
          id={`${idPrefix}-key`}
          label="Absoluter Pfad zur Key-Datei"
          placeholder="/Users/name/.ssh/id_ed25519"
          value={keyFile}
          onChange={(event) => onKeyFile(event.target.value)}
        />
      )}
      {auth === "agent" ? (
        <div className="grid gap-1.5">
          <ConnectionField
            id={`${idPrefix}-agent`}
            label="Agent-Socket (optional)"
            placeholder="Leer lassen für SSH_AUTH_SOCK"
            value={agentSocket}
            onChange={(event) => onAgentSocket(event.target.value)}
          />
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              type="button"
              size="sm"
              variant={agentSocket ? "ghost" : "secondary"}
              className="h-7 text-xs"
              onClick={() => onAgentSocket("")}
            >
              Standard-Agent
            </Button>
            {onePassword && (
              <Button
                type="button"
                size="sm"
                variant={agentSocket === onePassword ? "secondary" : "ghost"}
                className="h-7 text-xs"
                onClick={() => onAgentSocket(onePassword)}
              >
                1Password
              </Button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground">
            Alle Schlüssel des Agents werden nacheinander probiert.
            {onePassword
              ? ""
              : " Unter Windows nutzt 1Password die OpenSSH-Pipe; „pageant“ wählt Pageant."}
          </p>
        </div>
      ) : (
        <ConnectionField
          id={`${idPrefix}-password`}
          label={auth === "key" ? "Passphrase (optional)" : "SSH-Passwort"}
          type="password"
          value={secret}
          placeholder={secretPlaceholder}
          onChange={(event) => onSecret(event.target.value)}
        />
      )}
    </>
  );
}
