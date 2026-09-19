import { LockKeyhole } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import type { DatabaseKind, ProviderInfo } from "@/lib/db";
import { ConnectionField } from "../connection-field";
import { placeholderDefaults } from "./seed";

export function ConnectionHostFields({
  info,
  kind,
  host,
  setHost,
  port,
  setPort,
  database,
  setDatabase,
  databaseLabel,
  trusted,
  setTrusted,
  windowsAuth,
  user,
  setUser,
  password,
  setPassword,
}: {
  info: ProviderInfo;
  kind: DatabaseKind;
  host: string;
  setHost: (value: string) => void;
  port: string;
  setPort: (value: string) => void;
  database: string;
  setDatabase: (value: string) => void;
  databaseLabel: string;
  trusted: boolean;
  setTrusted: (value: boolean) => void;
  windowsAuth: boolean;
  user: string;
  setUser: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[1fr_90px] gap-3">
        <ConnectionField
          id="connection-host"
          label="Host"
          value={host}
          onChange={(event) => setHost(event.target.value)}
        />
        <ConnectionField
          id="connection-port"
          label="Port"
          inputMode="numeric"
          value={port}
          onChange={(event) => setPort(event.target.value)}
        />
      </div>
      <ConnectionField
        id="connection-database"
        label={databaseLabel}
        value={database}
        placeholder={placeholderDefaults(info).database}
        onChange={(event) => setDatabase(event.target.value)}
      />
      {kind === "mssql" && (
        <label className="flex items-center justify-between gap-3 text-xs font-medium">
          <span className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <LockKeyhole className="size-4 text-muted-foreground" /> Windows-Authentifizierung
            </span>
            <span className="font-normal text-muted-foreground">
              Meldet mit dem angemeldeten Windows-Konto an.
            </span>
          </span>
          <Switch
            checked={trusted}
            onCheckedChange={setTrusted}
            aria-label="Windows-Authentifizierung"
          />
        </label>
      )}
      <div className="grid grid-cols-2 gap-3">
        <ConnectionField
          id="connection-user"
          label={windowsAuth ? "Benutzer (optional)" : "Benutzer"}
          value={user}
          onChange={(event) => setUser(event.target.value)}
        />
        <ConnectionField
          id="connection-password"
          label={windowsAuth ? "Passwort (optional)" : "Passwort"}
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </div>
    </div>
  );
}
